"""Unit tests for scripts/social_schedule.py's terraform-output config
resolution (the SOCIAL_* env vars social/handler.py's storage/media/
scheduling/alerts modules read at import time). subprocess.run is always
mocked -- these tests never invoke real terraform and never touch AWS.

scripts/social_schedule.py lives outside any package (scripts/ has no
__init__.py), so it's loaded via importlib.util.spec_from_file_location
rather than a normal import. The module's CLI only runs under
`if __name__ == "__main__":`, so loading it here as a plain module just
defines the functions/constants we want to test."""
import importlib.util
import json
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

_SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "social_schedule.py"


def _loadScript():
    spec = importlib.util.spec_from_file_location("social_schedule_script_under_test", _SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


socialSchedule = _loadScript()

ALL_ENV_NAMES = list(socialSchedule.SOCIAL_ENV_TERRAFORM_OUTPUTS.keys())


def _fakeTerraformOutputJson(overrides=None, omit=()):
    """Build a `terraform output -json`-shaped payload for all six outputs,
    keyed by terraform output name (not env var name), skipping any in
    `omit` and applying any string `overrides` keyed by output name."""
    values = {
        "socialPostsTableName": "fus-social-posts",
        "socialMediaBucketName": "fus-social-media-bucket",
        "socialAlertsTopicArn": "arn:aws:sns:us-east-1:123456789012:fus-social-alerts",
        "socialScheduleGroupName": "fus-social",
        "socialPublisherArn": "arn:aws:lambda:us-east-1:123456789012:function:fus-social-publisher",
        "socialSchedulerRoleArn": "arn:aws:iam::123456789012:role/fus-social-scheduler",
    }
    if overrides:
        values.update(overrides)
    return {name: {"value": val} for name, val in values.items() if name not in omit}


@pytest.fixture(autouse=True)
def _cleanSocialEnv(monkeypatch):
    """Every test starts with none of the SOCIAL_* vars set, and monkeypatch
    restores the real environment afterward regardless of what the code
    under test mutated."""
    for name in ALL_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    yield


def test_fills_all_six_env_vars_from_terraform_output(monkeypatch):
    fakeProc = subprocess.CompletedProcess(
        args=["terraform"], returncode=0,
        stdout=json.dumps(_fakeTerraformOutputJson()), stderr="",
    )
    with patch("subprocess.run", return_value=fakeProc) as mockRun:
        socialSchedule._resolveSocialEnvFromTerraform()

    mockRun.assert_called_once()
    calledArgv = mockRun.call_args.args[0]
    assert calledArgv[0] == "terraform"
    assert "output" in calledArgv and "-json" in calledArgv

    import os
    assert os.environ["SOCIAL_TABLE"] == "fus-social-posts"
    assert os.environ["SOCIAL_MEDIA_BUCKET"] == "fus-social-media-bucket"
    assert os.environ["SOCIAL_ALERT_TOPIC_ARN"] == "arn:aws:sns:us-east-1:123456789012:fus-social-alerts"
    assert os.environ["SOCIAL_SCHEDULE_GROUP"] == "fus-social"
    assert os.environ["SOCIAL_PUBLISHER_ARN"] == "arn:aws:lambda:us-east-1:123456789012:function:fus-social-publisher"
    assert os.environ["SOCIAL_SCHEDULER_ROLE_ARN"] == "arn:aws:iam::123456789012:role/fus-social-scheduler"


def test_preexisting_env_var_is_not_overwritten(monkeypatch):
    monkeypatch.setenv("SOCIAL_TABLE", "my-manually-exported-table")
    fakeProc = subprocess.CompletedProcess(
        args=["terraform"], returncode=0,
        stdout=json.dumps(_fakeTerraformOutputJson()), stderr="",
    )
    with patch("subprocess.run", return_value=fakeProc):
        socialSchedule._resolveSocialEnvFromTerraform()

    import os
    # untouched -- the pre-set value wins
    assert os.environ["SOCIAL_TABLE"] == "my-manually-exported-table"
    # everything else still gets filled in from terraform output
    assert os.environ["SOCIAL_MEDIA_BUCKET"] == "fus-social-media-bucket"
    assert os.environ["SOCIAL_SCHEDULE_GROUP"] == "fus-social"


def test_terraform_binary_missing_is_handled_gracefully(capsys):
    with patch("subprocess.run", side_effect=FileNotFoundError("no such file")):
        socialSchedule._resolveSocialEnvFromTerraform()  # must not raise

    err = capsys.readouterr().err
    assert "terraform" in err.lower()
    assert "not found" in err.lower() or "path" in err.lower()

    import os
    for name in ALL_ENV_NAMES:
        assert not os.environ.get(name)


def test_terraform_nonzero_exit_prints_init_hint_no_traceback(capsys):
    fakeProc = subprocess.CompletedProcess(
        args=["terraform"], returncode=1, stdout="",
        stderr="Error: no state file was found\nRun `terraform init`.",
    )
    with patch("subprocess.run", return_value=fakeProc):
        socialSchedule._resolveSocialEnvFromTerraform()  # must not raise

    err = capsys.readouterr().err
    assert "terraform -chdir=infra init" in err
    assert "no state file was found" in err


def test_terraform_timeout_is_handled_gracefully(capsys):
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["terraform"], timeout=30)):
        socialSchedule._resolveSocialEnvFromTerraform()  # must not raise

    err = capsys.readouterr().err
    assert "timed out" in err.lower() or "did not finish" in err.lower()

    import os
    for name in ALL_ENV_NAMES:
        assert not os.environ.get(name)


def test_missing_output_key_names_the_specific_missing_key(capsys):
    fakeProc = subprocess.CompletedProcess(
        args=["terraform"], returncode=0,
        stdout=json.dumps(_fakeTerraformOutputJson(omit=["socialPublisherArn"])), stderr="",
    )
    with patch("subprocess.run", return_value=fakeProc):
        socialSchedule._resolveSocialEnvFromTerraform()

    err = capsys.readouterr().err
    assert "socialPublisherArn" in err
    assert "SOCIAL_PUBLISHER_ARN" in err

    import os
    assert not os.environ.get("SOCIAL_PUBLISHER_ARN")
    # the other five were still resolved fine
    assert os.environ["SOCIAL_TABLE"] == "fus-social-posts"
    assert os.environ["SOCIAL_SCHEDULER_ROLE_ARN"] == "arn:aws:iam::123456789012:role/fus-social-scheduler"


def test_no_terraform_flag_skips_the_subprocess_call_entirely():
    with patch("subprocess.run") as mockRun:
        socialSchedule._applyTerraformConfig(noTerraform=True)

    mockRun.assert_not_called()
