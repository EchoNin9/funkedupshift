import os
import json
import gzip
import datetime
import logging
import time
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize clients outside handler for reuse
s3_client = boto3.client('s3')
logs_client = boto3.client('logs')
cw_client = boto3.client('cloudwatch')
dynamodb = boto3.resource('dynamodb')

def get_db_table():
    table_name = os.environ.get("TABLE_NAME", "fus-main")
    return dynamodb.Table(table_name)

def handler(event, context):
    logger.info(f"Event: {json.dumps(event)}")
    
    # 1. Determine date
    target_date_str = None
    if event.get("action") == "recompute" and event.get("date"):
        target_date_str = event["date"]
    else:
        # Default to yesterday for cron
        yesterday = datetime.datetime.utcnow() - datetime.timedelta(days=1)
        target_date_str = yesterday.strftime("%Y-%m-%d")
        
    date_obj = datetime.datetime.strptime(target_date_str, "%Y-%m-%d")
    
    # 48h window for insights
    end_time = int((date_obj + datetime.timedelta(days=1)).timestamp())
    start_time = int((date_obj - datetime.timedelta(days=1)).timestamp())
    
    stats = {
        "date": target_date_str,
        "s3_log_lines": 0,
        "metrics": {},
        "click_paths": []
    }
    
    # 2. Parse S3 logs. CloudFront keys look like
    #   <prefix><dist-id>.YYYY-MM-DD-HH.<hash>.gz  (e.g. production/E19S....2026-07-20-22.abcd.gz)
    # so the date lives *inside* the key, not as its prefix — match on ".<date>-".
    bucket = os.environ.get("CLOUDFRONT_LOG_BUCKET")
    if bucket:
        prefix = os.environ.get("CLOUDFRONT_LOG_PREFIX", "")
        try:
            paginator = s3_client.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    if key.endswith('.gz') and f".{target_date_str}-" in key:
                        resp = s3_client.get_object(Bucket=bucket, Key=key)
                        # Decompress on the fly; skip CloudFront's #Version/#Fields header lines
                        with gzip.GzipFile(fileobj=resp['Body'], mode='rb') as gz:
                            for line in gz:
                                if not line.startswith(b'#'):
                                    stats["s3_log_lines"] += 1
        except Exception as e:
            logger.error(f"Error reading S3 logs: {e}")
            
    # 3. Query CloudWatch metrics
    try:
        metric_data = cw_client.get_metric_statistics(
            Namespace='AWS/ApiGateway',
            MetricName='4XXError',
            StartTime=date_obj,
            EndTime=date_obj + datetime.timedelta(days=1),
            Period=86400,
            Statistics=['Sum']
        )
        if metric_data.get('Datapoints'):
            stats["metrics"]["4xx_errors"] = metric_data['Datapoints'][0]['Sum']
    except Exception as e:
        logger.error(f"Error querying metrics: {e}")

    # 4. Query CloudWatch Log Insights
    try:
        log_group = os.environ.get("API_LOG_GROUP_NAME", "/aws/lambda/fus-api")
        # The API emits one structured JSON line per request: {"ts","sub","method","path"}.
        # "sub" is unique to those lines, so filter on it (the old /click/ matched nothing).
        query = 'fields @timestamp, @message | filter @message like /"sub":/ | sort @timestamp desc | limit 50'
        start_query_resp = logs_client.start_query(
            logGroupName=log_group,
            startTime=start_time,
            endTime=end_time,
            queryString=query
        )
        query_id = start_query_resp['queryId']
        
        status = 'Running'
        results = []
        # Wait for query to complete
        for _ in range(10): # max 10 seconds to wait in lambda to avoid hanging forever
            res = logs_client.get_query_results(queryId=query_id)
            status = res['status']
            if status == 'Complete':
                results = res.get('results', [])
                break
            time.sleep(1)
                
        paths = []
        for row in results:
            msg = next((f['value'] for f in row if f['field'] == '@message'), None)
            if not msg:
                continue
            # @message is a Lambda log line wrapping the JSON payload; pull the
            # JSON out and render "sub method path". Fall back to the raw line.
            entry = msg[:100]
            brace = msg.find('{')
            if brace != -1:
                try:
                    p = json.loads(msg[brace:])
                    entry = f"{p.get('sub', '?')}  {p.get('method', '')} {p.get('path', '')}".strip()
                except (ValueError, TypeError):
                    pass
            paths.append(entry)
        stats["click_paths"] = paths
    except Exception as e:
        logger.error(f"Error querying log insights: {e}")
        
    # 5. Write to DynamoDB idempotently
    try:
        table = get_db_table()
        table.put_item(
            Item={
                'PK': f"STATS#DAILY#{target_date_str}",
                'SK': "METADATA",
                'stats': stats,
                'updated_at': datetime.datetime.utcnow().isoformat()
            }
        )
    except Exception as e:
        logger.error(f"Error writing to DDB: {e}")
        
    return {
        "statusCode": 200,
        "body": json.dumps({"message": "Success", "date": target_date_str, "stats": stats})
    }
