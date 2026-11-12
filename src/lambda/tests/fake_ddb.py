"""Tiny in-memory DynamoDB (typed items) covering the calls the finance modules make."""
import copy

from botocore.exceptions import ClientError


def _cond_fail():
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "Write")


class FakeTable:
    def __init__(self):
        self.items = {}
        self.writes = []  # (op, kwargs) for every write, for plaintext-leak assertions

    # --- helpers
    def put(self, item):
        self.items[(item["PK"]["S"], item["SK"]["S"])] = copy.deepcopy(item)

    def _check(self, cond, item, values):
        if not cond:
            return
        for clause in cond.split(" AND "):
            clause = clause.strip()
            if clause == "attribute_exists(SK)":
                ok = item is not None
            elif clause.startswith("attribute_not_exists("):
                ok = item is None or clause[21:-1] not in item
            elif clause.startswith("attribute_not_exists"):
                ok = True
            elif " = :" in clause:
                attr, ph = clause.split(" = ")
                ok = item is not None and item.get(attr) == values[ph]
            else:
                raise NotImplementedError(clause)
            if not ok:
                raise _cond_fail()

    # --- API
    def get_item(self, TableName, Key):
        it = self.items.get((Key["PK"]["S"], Key["SK"]["S"]))
        return {"Item": copy.deepcopy(it)} if it else {}

    def put_item(self, TableName, Item, ConditionExpression=None, **kw):
        self.writes.append(("put", {"Item": Item}))
        self.put(Item)

    def delete_item(self, TableName, Key, **kw):
        self.writes.append(("delete", {"Key": Key}))
        self.items.pop((Key["PK"]["S"], Key["SK"]["S"]), None)

    def update_item(self, TableName, Key, UpdateExpression, ExpressionAttributeValues,
                    ConditionExpression=None, ExpressionAttributeNames=None):
        self.writes.append(("update", {"Key": Key, "Values": ExpressionAttributeValues}))
        k = (Key["PK"]["S"], Key["SK"]["S"])
        item = self.items.get(k)
        names = ExpressionAttributeNames or {}
        cond = ConditionExpression
        for n, a in names.items():
            cond = cond.replace(n, a) if cond else cond
        self._check(cond, item, ExpressionAttributeValues)
        if item is None:
            item = {"PK": Key["PK"], "SK": Key["SK"]}
            self.items[k] = item
        assert UpdateExpression.startswith("SET ")
        for part in UpdateExpression[4:].split(", "):
            attr, ph = part.split(" = ")
            item[names.get(attr, attr)] = copy.deepcopy(ExpressionAttributeValues[ph])

    def batch_write_item(self, RequestItems):
        for table, reqs in RequestItems.items():
            for r in reqs:
                self.writes.append(("batch_put", {"Item": r["PutRequest"]["Item"]}))
                self.put(r["PutRequest"]["Item"])
        return {"UnprocessedItems": {}}

    def query(self, TableName, KeyConditionExpression, ExpressionAttributeValues, **kw):
        v = ExpressionAttributeValues
        out = []
        for (pk, sk), it in sorted(self.items.items()):
            if pk != v[":pk"]["S"]:
                continue
            if "begins_with" in KeyConditionExpression:
                ok = sk.startswith(v[":sk"]["S"])
            else:
                ok = v[":lo"]["S"] <= sk <= v[":hi"]["S"]
            if ok:
                out.append(copy.deepcopy(it))
        return {"Items": out}

    def scan(self, TableName, FilterExpression=None, ExpressionAttributeValues=None, **kw):
        prefix = ExpressionAttributeValues[":bpf"]["S"]
        return {"Items": [copy.deepcopy(i) for (pk, sk), i in sorted(self.items.items())
                          if sk.startswith(prefix)]}
