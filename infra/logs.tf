# ------------------------------------------------------------------------------
# Lambda CloudWatch log groups, managed in IaC so retention is enforced.
# ponytail: a new Lambda must be added to this map, or its group is auto-created
# by Lambda with never-expire retention.
# ------------------------------------------------------------------------------
locals {
  lambdaLogGroups = {
    api                = aws_lambda_function.api.function_name
    thumb              = aws_lambda_function.thumb.function_name
    mcp                = aws_lambda_function.mcp.function_name
    collector          = aws_lambda_function.collector.function_name
    socialApi          = aws_lambda_function.socialApi.function_name
    socialPublisher    = aws_lambda_function.socialPublisher.function_name
    socialMaintenance  = aws_lambda_function.socialMaintenance.function_name
    socialTokenRefresh = aws_lambda_function.socialTokenRefresh.function_name
    lipsyncApi         = aws_lambda_function.lipsyncApi.function_name
    lipsyncRunner      = aws_lambda_function.lipsyncRunner.function_name
    lipsyncMaintenance = aws_lambda_function.lipsyncMaintenance.function_name
    tools              = aws_lambda_function.tools.function_name
  }
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambdaLogGroups
  name              = "/aws/lambda/${each.value}"
  retention_in_days = 180
}

# Adopt the 11 groups Lambda already auto-created (mcp does not exist yet and
# is created by apply). Import blocks are no-ops once in state; delete them
# after the first successful apply. (No for_each: CI runs Terraform 1.6.)
import {
  to = aws_cloudwatch_log_group.lambda["api"]
  id = "/aws/lambda/fus-api"
}
import {
  to = aws_cloudwatch_log_group.lambda["thumb"]
  id = "/aws/lambda/fus-thumb"
}
import {
  to = aws_cloudwatch_log_group.lambda["collector"]
  id = "/aws/lambda/fus-collector"
}
import {
  to = aws_cloudwatch_log_group.lambda["socialApi"]
  id = "/aws/lambda/fus-social-api"
}
import {
  to = aws_cloudwatch_log_group.lambda["socialPublisher"]
  id = "/aws/lambda/fus-social-publisher"
}
import {
  to = aws_cloudwatch_log_group.lambda["socialMaintenance"]
  id = "/aws/lambda/fus-social-maintenance"
}
import {
  to = aws_cloudwatch_log_group.lambda["socialTokenRefresh"]
  id = "/aws/lambda/fus-social-token-refresh"
}
import {
  to = aws_cloudwatch_log_group.lambda["lipsyncApi"]
  id = "/aws/lambda/fus-lipsync-api"
}
import {
  to = aws_cloudwatch_log_group.lambda["lipsyncRunner"]
  id = "/aws/lambda/fus-lipsync-runner"
}
import {
  to = aws_cloudwatch_log_group.lambda["lipsyncMaintenance"]
  id = "/aws/lambda/fus-lipsync-maintenance"
}
import {
  to = aws_cloudwatch_log_group.lambda["tools"]
  id = "/aws/lambda/fus-tools"
}
