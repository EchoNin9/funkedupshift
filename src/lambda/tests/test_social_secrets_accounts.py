"""listAccounts() display-name behaviour.

Bluesky stores a "handle" leaf in SSM; Instagram does not -- its identity leaf
is ig-user-id, a number that means nothing to a human. Without a fallback the
composer renders every Instagram account as "instagram · @", which makes them
indistinguishable in the account picker.
"""
from unittest.mock import MagicMock, patch


def _page(names):
    return {"Parameters": [{"Name": n, "Value": v} for n, v in names]}


def _mockSsm(names):
    client = MagicMock()
    paginator = MagicMock()
    paginator.paginate.return_value = [_page(names)]
    client.get_paginator.return_value = paginator
    return client


def test_bluesky_handle_value_is_used_when_present():
    from social import secrets

    client = _mockSsm([
        ("/funkedupshift/social/bluesky/personal/handle", "jinksy.bsky.social"),
        ("/funkedupshift/social/bluesky/personal/app-password", "never-read"),
    ])
    with patch.object(secrets, "_client", return_value=client):
        accounts = secrets.listAccounts()

    assert accounts == [
        {"platform": "bluesky", "accountId": "personal", "handle": "jinksy.bsky.social"}
    ]


def test_instagram_without_handle_leaf_falls_back_to_slug():
    from social import secrets

    client = _mockSsm([
        ("/funkedupshift/social/instagram/jinksninja/ig-user-id", "17841432563762849"),
        ("/funkedupshift/social/instagram/jinksninja/access-token", "never-read"),
    ])
    with patch.object(secrets, "_client", return_value=client):
        accounts = secrets.listAccounts()

    assert len(accounts) == 1
    # Falls back to the slug rather than an empty string, so the picker shows
    # "instagram · @jinksninja" instead of "instagram · @".
    assert accounts[0]["handle"] == "jinksninja"


def test_explicit_handle_leaf_overrides_the_slug_fallback():
    from social import secrets

    client = _mockSsm([
        ("/funkedupshift/social/instagram/simmerdown/ig-user-id", "17841446504007536"),
        ("/funkedupshift/social/instagram/simmerdown/handle", "simmerdownstyle"),
    ])
    with patch.object(secrets, "_client", return_value=client):
        accounts = secrets.listAccounts()

    assert accounts[0]["handle"] == "simmerdownstyle"


def test_mixed_platforms_each_get_a_usable_display_name():
    from social import secrets

    client = _mockSsm([
        ("/funkedupshift/social/bluesky/public/handle", "jinks.ninja"),
        ("/funkedupshift/social/instagram/orangewhip/ig-user-id", "17841474632512586"),
        ("/funkedupshift/social/instagram/funkedupshift/ig-user-id", "17841462404113828"),
    ])
    with patch.object(secrets, "_client", return_value=client):
        accounts = secrets.listAccounts()

    assert all(a["handle"] for a in accounts), "no account may render a blank handle"
    assert {a["accountId"]: a["handle"] for a in accounts} == {
        "public": "jinks.ninja",
        "orangewhip": "orangewhip",
        "funkedupshift": "funkedupshift",
    }
