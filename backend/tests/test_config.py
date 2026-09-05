import pytest

from app.config import _Settings


CONFIG_NAMES = (
    "IGNAV_API_KEY",
    "IGNAV_BASE_URL",
    "AMADEUS_CLIENT_ID",
    "AMADEUS_CLIENT_SECRET",
    "AMADEUS_BASE_URL",
    "DEMO_MODE",
    "CORS_ORIGINS",
    "UPLOAD_MAX_BYTES",
)


def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in CONFIG_NAMES:
        monkeypatch.delenv(name, raising=False)


def test_default_settings_are_demo_safe(monkeypatch: pytest.MonkeyPatch) -> None:
    clean_environment(monkeypatch)
    configured = _Settings()

    assert configured.demo_mode is True
    assert configured.provider_credentials_configured is False
    assert configured.amadeus_base_url == "https://test.api.amadeus.com"


@pytest.mark.parametrize("value", ["", "sometimes", "truthy", "2"])
def test_demo_mode_rejects_ambiguous_values(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    clean_environment(monkeypatch)
    monkeypatch.setenv("DEMO_MODE", value)

    with pytest.raises(ValueError, match="DEMO_MODE must be one of"):
        _Settings()


def test_partial_provider_credentials_fail_fast(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clean_environment(monkeypatch)
    monkeypatch.setenv("AMADEUS_CLIENT_ID", "client-id")

    with pytest.raises(ValueError, match="must be set together"):
        _Settings()


def test_live_mode_requires_complete_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clean_environment(monkeypatch)
    monkeypatch.setenv("DEMO_MODE", "false")

    with pytest.raises(ValueError, match="requires IGNAV_API_KEY or both"):
        _Settings()


def test_live_mode_accepts_complete_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clean_environment(monkeypatch)
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setenv("AMADEUS_CLIENT_ID", "client-id")
    monkeypatch.setenv("AMADEUS_CLIENT_SECRET", "client-secret")

    configured = _Settings()

    assert configured.demo_mode is False
    assert configured.provider_credentials_configured is True
    assert configured.masked_credentials()["amadeus_client_secret"] == "(set)"


@pytest.mark.parametrize("value", ["0", "-1", "not-a-number"])
def test_upload_limit_must_be_positive(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    clean_environment(monkeypatch)
    monkeypatch.setenv("UPLOAD_MAX_BYTES", value)

    with pytest.raises(ValueError, match="positive integer"):
        _Settings()


def test_cors_rejects_wildcard(monkeypatch: pytest.MonkeyPatch) -> None:
    clean_environment(monkeypatch)
    monkeypatch.setenv("CORS_ORIGINS", "*")

    with pytest.raises(ValueError, match="explicit origins"):
        _Settings()


def test_remote_provider_url_requires_https(monkeypatch: pytest.MonkeyPatch) -> None:
    clean_environment(monkeypatch)
    monkeypatch.setenv("AMADEUS_BASE_URL", "http://provider.example.test")

    with pytest.raises(ValueError, match="must use HTTPS"):
        _Settings()


def test_local_http_provider_url_is_available_for_contract_tests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clean_environment(monkeypatch)
    monkeypatch.setenv("AMADEUS_BASE_URL", "http://127.0.0.1:9000/")

    assert _Settings().amadeus_base_url == "http://127.0.0.1:9000"


@pytest.mark.parametrize("demo", ["true", "false"])
def test_ignav_credentials_allow_demo_preparation_or_live_mode(monkeypatch, demo):
    clean_environment(monkeypatch)
    monkeypatch.setenv("IGNAV_API_KEY", "test-only-key")
    monkeypatch.setenv("DEMO_MODE", demo)
    configured = _Settings()
    assert configured.demo_mode is (demo == "true")
    assert configured.provider_credentials_configured
    assert configured.ignav_base_url == "https://ignav.com/api"
    assert configured.masked_credentials()["ignav_api_key"] == "(set)"
    assert "test-only-key" not in str(configured.masked_credentials())


def test_whitespace_ignav_key_cannot_enable_live_mode(monkeypatch):
    clean_environment(monkeypatch)
    monkeypatch.setenv("IGNAV_API_KEY", "   ")
    monkeypatch.setenv("DEMO_MODE", "false")
    with pytest.raises(ValueError, match="requires IGNAV_API_KEY"):
        _Settings()


@pytest.mark.parametrize("url", [
    "http://remote.test/api", "relative", "https://key@remote.test/api",
    "https://remote.test/api?key=secret", "https://remote.test/api#secret",
])
def test_invalid_ignav_url_rejected_without_echoing_value(monkeypatch, url):
    clean_environment(monkeypatch)
    monkeypatch.setenv("IGNAV_BASE_URL", url)
    with pytest.raises(ValueError, match="IGNAV_BASE_URL") as error:
        _Settings()
    assert url not in str(error.value)


def test_custom_ignav_base_url(monkeypatch):
    clean_environment(monkeypatch)
    monkeypatch.setenv("IGNAV_BASE_URL", "http://127.0.0.1:9000/api/")
    assert _Settings().ignav_base_url == "http://127.0.0.1:9000/api"
