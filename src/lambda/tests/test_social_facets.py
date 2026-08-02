"""Unit tests for Bluesky rich-text facet byte-offset building
(src/lambda/social/publishers/bluesky.py buildFacets). Byte offsets are the
whole point: AT Protocol facets index into text.encode("utf-8"), NOT
character indices, so anything with multi-byte characters ahead of a link
needs this to be exactly right or the link silently fails to render."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from social.publishers.bluesky import buildFacets  # noqa: E402


# --- URLs: exact byte offsets ---------------------------------------------------


def test_ascii_single_url_exact_offsets():
    text = "check out https://example.com today"
    facets = buildFacets(text)
    assert len(facets) == 1
    feature = facets[0]["features"][0]
    assert feature["$type"] == "app.bsky.richtext.facet#link"
    assert feature["uri"] == "https://example.com"
    start, end = facets[0]["index"]["byteStart"], facets[0]["index"]["byteEnd"]
    assert start == len("check out ")
    assert text.encode("utf-8")[start:end].decode("utf-8") == "https://example.com"


def test_emoji_before_url_shifts_offsets_by_4_bytes_each():
    # Each of these emoji is a 4-byte UTF-8 sequence.
    text = "\U0001F389\U0001F389 https://example.com"
    facets = buildFacets(text)
    assert len(facets) == 1
    start, end = facets[0]["index"]["byteStart"], facets[0]["index"]["byteEnd"]
    assert start == 4 + 4 + 1  # two emoji + one space
    assert end == start + len("https://example.com")
    assert text.encode("utf-8")[start:end].decode("utf-8") == "https://example.com"


def test_cjk_before_url_offsets():
    text = "你好 https://example.com"  # "ni hao "
    facets = buildFacets(text)
    assert len(facets) == 1
    start = facets[0]["index"]["byteStart"]
    assert start == 3 + 3 + 1  # two 3-byte CJK chars + one space
    end = facets[0]["index"]["byteEnd"]
    assert text.encode("utf-8")[start:end].decode("utf-8") == "https://example.com"


def test_accented_latin_before_url_offsets():
    text = "café https://example.com"  # "café "
    facets = buildFacets(text)
    assert len(facets) == 1
    start = facets[0]["index"]["byteStart"]
    assert start == len("caf".encode("utf-8")) + 2 + 1  # c,a,f (1 byte each) + é (2 bytes) + space
    end = facets[0]["index"]["byteEnd"]
    assert text.encode("utf-8")[start:end].decode("utf-8") == "https://example.com"


def test_mixed_emoji_cjk_ascii_offsets():
    text = "hi \U0001F389 你好 https://example.com"
    facets = buildFacets(text)
    assert len(facets) == 1
    prefix = "hi \U0001F389 你好 "
    assert facets[0]["index"]["byteStart"] == len(prefix.encode("utf-8"))


def test_two_urls_both_correct_and_non_overlapping():
    text = "first https://a.example.com then https://b.example.com done"
    facets = buildFacets(text)
    assert len(facets) == 2
    uris = [f["features"][0]["uri"] for f in facets]
    assert uris == ["https://a.example.com", "https://b.example.com"]
    assert facets[0]["index"]["byteEnd"] <= facets[1]["index"]["byteStart"]
    encoded = text.encode("utf-8")
    for f in facets:
        s, e = f["index"]["byteStart"], f["index"]["byteEnd"]
        assert encoded[s:e].decode("utf-8") == f["features"][0]["uri"]


def test_at_sign_inside_url_does_not_produce_overlapping_mention_facet():
    """medium.com/@user and youtube.com/@channel are everyday URLs. The '@'
    in the path must not also become a mention facet — AT Protocol facets
    must not overlap, and a mention nested inside a link is a malformed
    record. Resolver returns a DID for everything, so a bug here shows up."""
    text = "watch https://youtube.com/@alice.bsky.social today"
    facets = buildFacets(text, lambda h: "did:plc:whatever")
    assert len(facets) == 1
    assert facets[0]["features"][0]["$type"] == "app.bsky.richtext.facet#link"
    assert facets[0]["features"][0]["uri"] == "https://youtube.com/@alice.bsky.social"


def test_hash_inside_url_does_not_produce_overlapping_tag_facet():
    text = "read https://example.com/docs#install now"
    facets = buildFacets(text)
    assert len(facets) == 1
    assert facets[0]["features"][0]["$type"] == "app.bsky.richtext.facet#link"


def test_real_mention_outside_url_still_works_alongside_a_url():
    """The overlap guard must not suppress legitimate mentions elsewhere."""
    text = "hey @bob.bsky.social see https://medium.com/@carol here"
    facets = buildFacets(text, lambda h: f"did:plc:{h.split('.')[0]}")
    kinds = [f["features"][0]["$type"].rsplit("#", 1)[-1] for f in facets]
    assert kinds == ["mention", "link"]
    assert facets[0]["features"][0]["did"] == "did:plc:bob"


def test_no_facets_overlap_across_varied_inputs():
    for text in [
        "hey @bob.bsky.social see https://medium.com/@carol #news",
        "🎉 @a.bsky.social https://x.com/@b.bsky.social #tag",
        "https://example.com/docs#install @real.bsky.social",
    ]:
        facets = buildFacets(text, lambda h: "did:plc:x")
        spans = [(f["index"]["byteStart"], f["index"]["byteEnd"]) for f in facets]
        assert spans == sorted(spans), text
        for a, b in zip(spans, spans[1:]):
            assert a[1] <= b[0], f"overlapping facets in {text!r}: {a} {b}"


def test_url_at_index_zero():
    text = "https://example.com is cool"
    facets = buildFacets(text)
    assert facets[0]["index"]["byteStart"] == 0
    assert facets[0]["features"][0]["uri"] == "https://example.com"


def test_url_at_very_end_of_string():
    text = "check this out https://example.com"
    facets = buildFacets(text)
    assert facets[0]["index"]["byteEnd"] == len(text.encode("utf-8"))


# --- trailing punctuation --------------------------------------------------------


@pytest.mark.parametrize("suffix", [".", ",", "!", "?"])
def test_trailing_punctuation_excluded(suffix):
    text = f"see https://example.com{suffix} okay"
    facets = buildFacets(text)
    assert len(facets) == 1
    assert facets[0]["features"][0]["uri"] == "https://example.com"


def test_url_wrapped_in_parentheses():
    text = "(see https://example.com)"
    facets = buildFacets(text)
    assert len(facets) == 1
    assert facets[0]["features"][0]["uri"] == "https://example.com"


def test_url_with_balanced_internal_parens_kept():
    text = "wiki https://en.wikipedia.org/wiki/Foo_(bar)"
    facets = buildFacets(text)
    assert len(facets) == 1
    assert facets[0]["features"][0]["uri"] == "https://en.wikipedia.org/wiki/Foo_(bar)"


# --- no facets --------------------------------------------------------------------


def test_no_links_mentions_tags_returns_empty_list():
    assert buildFacets("just plain text, nothing special here") == []


# --- mentions -----------------------------------------------------------------


def test_mention_resolves_to_did_facet():
    text = "hello @alice.bsky.social welcome"
    facets = buildFacets(
        text, resolveHandleFn=lambda h: "did:plc:abc123" if h == "alice.bsky.social" else None
    )
    assert len(facets) == 1
    feature = facets[0]["features"][0]
    assert feature["$type"] == "app.bsky.richtext.facet#mention"
    assert feature["did"] == "did:plc:abc123"
    s, e = facets[0]["index"]["byteStart"], facets[0]["index"]["byteEnd"]
    assert text.encode("utf-8")[s:e].decode("utf-8") == "@alice.bsky.social"


def test_mention_fails_to_resolve_is_skipped_no_exception():
    text = "hello @doesnotexist.bsky.social there"
    facets = buildFacets(text, resolveHandleFn=lambda h: None)
    assert facets == []


def test_mention_resolver_raising_is_swallowed_not_propagated():
    def boom(_handle):
        raise RuntimeError("network down")

    text = "hello @alice.bsky.social there"
    facets = buildFacets(text, resolveHandleFn=boom)  # must not raise
    assert facets == []


# --- hashtags -------------------------------------------------------------------


def test_hashtag_facet_tag_value_has_no_leading_hash():
    text = "loving this #sunset tonight"
    facets = buildFacets(text)
    assert len(facets) == 1
    feature = facets[0]["features"][0]
    assert feature["$type"] == "app.bsky.richtext.facet#tag"
    assert feature["tag"] == "sunset"


def test_hashtag_after_multibyte_text():
    text = "你好 #sunset"
    facets = buildFacets(text)
    assert len(facets) == 1
    s, e = facets[0]["index"]["byteStart"], facets[0]["index"]["byteEnd"]
    assert text.encode("utf-8")[s:e].decode("utf-8") == "#sunset"


# --- invariant: every facet round-trips exactly to its matched substring --------

INVARIANT_CASES = [
    "plain ascii https://example.com end",
    "\U0001F389 emoji https://example.com and #tag",
    "你好 CJK https://example.com and @alice.bsky.social",
    "café accented https://example.com, trailing punct.",
    "mix \U0001F389 你好 café https://a.example.com https://b.example.com #tag @alice.bsky.social",
    "https://example.com",
    "(https://example.com)",
    "no facets here at all",
    "trailing bang https://example.com!",
    "just a #hashtag with no links",
]


@pytest.mark.parametrize("text", INVARIANT_CASES)
def test_facet_byte_offsets_roundtrip_to_matched_substring(text):
    facets = buildFacets(text, resolveHandleFn=lambda h: "did:plc:test")
    encoded = text.encode("utf-8")
    for f in facets:
        s, e = f["index"]["byteStart"], f["index"]["byteEnd"]
        substr = encoded[s:e].decode("utf-8")
        feature = f["features"][0]
        if feature["$type"] == "app.bsky.richtext.facet#link":
            assert substr == feature["uri"]
        elif feature["$type"] == "app.bsky.richtext.facet#mention":
            assert substr.startswith("@")
        elif feature["$type"] == "app.bsky.richtext.facet#tag":
            assert substr == "#" + feature["tag"]
