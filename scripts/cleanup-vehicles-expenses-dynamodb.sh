#!/bin/bash
# Delete all vehicles and fuel entries from DynamoDB (vehicles expenses data).
# Uses AWS CLI. Requires jq.
# Table name defaults to fus-main; override with TABLE_NAME env var.

set -e
TABLE="${TABLE_NAME:-fus-main}"
REGION="${AWS_REGION:-us-east-1}"

echo "Cleaning vehicles expenses from table: $TABLE (region: $REGION)"
echo "This will delete all items where SK begins with VEHICLE#"
if [[ "$1" != "--force" && "$1" != "-f" ]]; then
  read -p "Continue? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

deleted=0
next_token=""

while true; do
  if [[ -n "$next_token" ]]; then
    resp=$(aws dynamodb scan \
      --table-name "$TABLE" \
      --region "$REGION" \
      --filter-expression "begins_with(SK, :sk)" \
      --expression-attribute-values '{":sk":{"S":"VEHICLE#"}}' \
      --projection-expression "PK,SK" \
      --output json \
      --starting-token "$next_token")
  else
    resp=$(aws dynamodb scan \
      --table-name "$TABLE" \
      --region "$REGION" \
      --filter-expression "begins_with(SK, :sk)" \
      --expression-attribute-values '{":sk":{"S":"VEHICLE#"}}' \
      --projection-expression "PK,SK" \
      --output json)
  fi

  count=$(echo "$resp" | jq '.Items | length')
  next_token=$(echo "$resp" | jq -r '.NextToken // empty')

  for ((i=0; i<count; i++)); do
    item=$(echo "$resp" | jq -c ".Items[$i]")
    key=$(echo "$item" | jq -c '{PK: .PK, SK: .SK}')
    aws dynamodb delete-item \
      --table-name "$TABLE" \
      --region "$REGION" \
      --key "$key"
    deleted=$((deleted + 1))
    echo "  Deleted $(echo "$item" | jq -r '.PK.S + " " + .SK.S')"
  done

  if [[ -z "$next_token" ]]; then
    break
  fi
done

echo "Done. Deleted $deleted items."
