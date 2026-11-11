from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./dev.db"
    jwt_secret: str = "change-me"
    jwt_expire_minutes: int = 720
    encryption_key: str = ""
    admin_email: str = "admin@example.com"
    admin_password: str = "change-me-now"
    allow_signup: bool = True  # merchants self-register; no admin approval
    public_pay_base: str = ""  # merchant site URL used in pay links; defaults to first FRONTEND_ORIGINS entry
    frontend_origins: str = "http://localhost:5173,http://localhost:5174"
    worker_shared_secret: str = "change-me-too"

    qr_expiry_seconds: int = 300
    match_grace_seconds: int = 30
    allow_unique_amount_match: bool = True
    require_email_auth: bool = True
    # Auto-verify a match when the email is from the official sender, passed aligned DKIM/SPF,
    # and matched unambiguously. Not bank-confirmed; ignored if a real verification adapter is configured.
    auto_verify_email: bool = True
    # Comma-separated FamPay official sender address(es). Only these are ever processed.
    fampay_official_senders: str = "no-reply@famapp.in"
    imap_poll_seconds: int = 20
    run_workers: bool = True

    payment_keywords: str = "received,credited,paid you,sent you,payment of"
    negative_keywords: str = "requested,request for,failed,declined,reminder,refund"

    verification_adapter: str = "none"
    verification_api_url: str = ""
    verification_api_key: str = ""


settings = Settings()
