from f.lib_zoom.web_utilities.utilities import setup
import logging
import json
import time
import time as time_module  # Aliased for timing measurements
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple, TypedDict, cast
from urllib.parse import urlparse, parse_qs
import psycopg2
from psycopg2.extras import RealDictCursor
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError


class postgresql(TypedDict):
    host: str
    port: int
    user: str
    dbname: str
    sslmode: str
    password: str
    root_certificate_pem: str

# Configure module logger
logger = logging.getLogger("sign_in_to_web_portal_v2")


def _configure_logging(debug: bool = False):
    """Configure logging for this script."""
    # Remove any existing handlers to avoid duplicates
    logger.handlers.clear()
    
    # Create console handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))
    logger.addHandler(handler)
    
    # Set level based on debug flag
    logger.setLevel(logging.DEBUG if debug else logging.INFO)
    
    # Prevent propagation to root logger to avoid duplicate messages
    logger.propagate = False


class ZoomAuthError(Exception):
    """Base exception for Zoom authentication errors."""
    def __init__(self, error_type: str, error_code: int | None, error_message: str, retryable: bool = False):
        self.error_type = error_type
        self.error_code = error_code
        self.error_message = error_message
        self.retryable = retryable
        super().__init__(f"{error_type}: {error_message}")
    
    def to_dict(self) -> dict:
        """Convert error to structured dict for graceful error handling."""
        return {
            "success": False,
            "error_type": self.error_type,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "retryable": self.retryable,
        }
    
    def handle(self, graceful: bool):
        """Either return dict or raise self based on graceful flag."""
        if graceful:
            return self.to_dict()
        raise self


class ZoomInvalidUserError(ZoomAuthError):
    """Raised when the user/email is not valid."""
    def __init__(self, error_code: int, error_message: str):
        super().__init__("invalid_user", error_code, error_message, retryable=False)


class ZoomBadPasswordError(ZoomAuthError):
    """Raised when the password is incorrect."""
    def __init__(self, error_code: int, error_message: str):
        super().__init__("bad_password", error_code, error_message, retryable=False)


class ZoomOTPRequiredError(ZoomAuthError):
    """Raised when OTP verification is required."""
    def __init__(self):
        super().__init__("otp_required", None, "OTP verification required", retryable=False)


class ZoomAccountBlockedError(ZoomAuthError):
    """Raised when account is blocked due to too many failed login attempts."""
    def __init__(self, error_code: int, error_message: str):
        super().__init__("account_blocked", error_code, error_message, retryable=False)


class ZoomMissingCookiesError(ZoomAuthError):
    """Raised when required authentication cookies are missing after login."""
    def __init__(self, missing_cookies: set):
        missing_list = sorted(missing_cookies)
        error_message = f"Missing required cookies: {', '.join(missing_list)}"
        super().__init__("missing_cookies", None, error_message, retryable=True)


def get_user_otp(user_id: str, postgresql: postgresql) -> Tuple[Optional[str], Optional[datetime]]:
    """
    Poll the database for OTP updates for a specific user.

    Args:
        user_id: The user ID to look up
        postgresql: Database connection configuration

    Returns:
        tuple: (otp, otp_updated_at) or (None, None) if not found
    """
    try:
        connect_params = {
            "host": postgresql["host"],
            "port": postgresql["port"],
            "user": postgresql["user"],
            "password": postgresql["password"],
            "dbname": postgresql["dbname"],
            "sslmode": postgresql["sslmode"],
        }
        
        # Use context managers to ensure connection is always closed
        with psycopg2.connect(**connect_params, cursor_factory=RealDictCursor) as conn:
            with conn.cursor() as cursor:
                query = """
                    SELECT otp, otp_updated_at, email
                    FROM zoom.users 
                    WHERE id = %s
                """
                cursor.execute(query, (user_id,))
                # RealDictCursor returns dict-like objects, not tuples
                result = cast(Optional[Dict[str, Any]], cursor.fetchone())

                if result:
                    db_email = result.get("email")
                    otp = result.get("otp")
                    otp_updated_at = result.get("otp_updated_at")
                    
                    # Log what we found for debugging
                    logger.debug(f"Found user in DB - ID: {user_id}, Email: {db_email}, OTP present: {otp is not None}, OTP updated at: {otp_updated_at}")
                    
                    if otp is None:
                        logger.debug(f"OTP is NULL in database for user_id: {user_id}")
                    if otp_updated_at is None:
                        logger.debug(f"otp_updated_at is NULL in database for user_id: {user_id}")
                    
                    return otp, otp_updated_at
                else:
                    logger.debug(f"No user found in database with user_id: {user_id}")
                    return None, None

    except Exception as e:
        logger.error(f"Database error: {str(e)}", exc_info=True)
        return None, None


def wait_for_recent_otp(user_id: str, postgresql: postgresql, timeout: int = 60, lookback_seconds: int = 60, poll_interval: int = 2) -> Optional[str]:
    """
    Poll the database for a recent OTP update.

    Args:
        user_id: The user ID to look up
        postgresql: Database connection configuration
        timeout: Maximum time to wait in seconds
        lookback_seconds: How many seconds back to consider OTP as "recent" (default: 60)
        poll_interval: Time between polls in seconds

    Returns:
        str: The OTP if found within timeout, None otherwise
    """
    start_time = datetime.now(timezone.utc)
    end_time = start_time + timedelta(seconds=timeout)

    logger.info(f"Polling for OTP update for user_id {user_id} (timeout: {timeout}s, lookback: {lookback_seconds}s)...")

    while datetime.now(timezone.utc) < end_time:
        otp, otp_updated_at = get_user_otp(user_id, postgresql)

        if otp and otp_updated_at:
            # Make sure we're comparing timezone-aware datetimes
            current_time = datetime.now(timezone.utc)

            # If otp_updated_at is naive, assume it's UTC
            if otp_updated_at.tzinfo is None:
                otp_updated_at = otp_updated_at.replace(tzinfo=timezone.utc)

            # Check if OTP was updated within the lookback window
            time_since_update = current_time - otp_updated_at
            if time_since_update.total_seconds() <= lookback_seconds:
                logger.info(
                    f"Found recent OTP update ({time_since_update.total_seconds():.1f}s ago, within {lookback_seconds}s lookback window)"
                )
                return otp
            else:
                logger.debug(
                    f"OTP exists but is {time_since_update.total_seconds():.1f}s old (exceeds {lookback_seconds}s lookback window)"
                )
        elif otp is None:
            logger.debug(f"OTP is NULL in database for user_id: {user_id}")
        elif otp_updated_at is None:
            logger.debug(f"otp_updated_at is NULL in database for user_id: {user_id}")
        else:
            logger.debug(f"No OTP found in database for user_id: {user_id}")

        time.sleep(poll_interval)

    logger.warning(f"Timeout waiting for OTP after {timeout} seconds (lookback window: {lookback_seconds}s)")
    return None


def extract_user_id_from_email(email: str) -> Optional[str]:
    """
    Extract user_id from email address if it contains user_id parameter.
    
    Example: dev-zoomotp+user_id=gM1CVkWkRSCl7q97_mBruQ@mail.windmill.zoomdemos.com
    Returns: gM1CVkWkRSCl7q97_mBruQ
    
    Args:
        email: Email address that may contain user_id parameter
        
    Returns:
        str: The extracted user_id, or None if not found
    """
    try:
        # Extract the local part (before @)
        local_part = email.split('@')[0]
        
        # Look for +user_id= pattern
        if '+user_id=' in local_part:
            # Extract everything after +user_id=
            user_id_part = local_part.split('+user_id=')[1]
            # The user_id is everything up to the @ (which we already split) or end of string
            user_id = user_id_part
            logger.debug(f"Extracted user_id '{user_id}' from email: {email}")
            return user_id
        else:
            logger.debug(f"No user_id parameter found in email: {email}")
            return None
    except Exception as e:
        logger.error(f"Error extracting user_id from email: {str(e)}")
        return None




def fetch_profile(
    page, 
    request_context, 
    base_url: str,
    use_lightweight: bool = True,
    reason: str = "authentication",
    http_request_timeout_ms: int = 15000
) -> None:
    """
    Fetch the Zoom profile page to ensure all cookies are set.
    
    This is a DRY helper that consolidates the profile-fetching logic used after
    both normal login and OTP verification.
    
    Note: Playwright processes Set-Cookie headers synchronously, so cookies are
    immediately available in context.cookies() after the HTTP response.
    
    Args:
        page: Playwright page object
        request_context: Playwright request context (page.request)
        base_url: Base URL for Zoom (e.g., "https://zoom.us")
        use_lightweight: If True, use HTTP GET; if False, use full page.goto()
        reason: Description for logging (e.g., "authentication", "OTP verification")
        http_request_timeout_ms: Timeout for HTTP requests in milliseconds (default: 15000)
    """
    profile_url = f"{base_url}/profile"
    
    if use_lightweight:
        # Lightweight approach - HTTP GET request
        logger.debug(f"Using lightweight request_context.get for /profile after {reason}")
        start = time_module.time()
        
        profile_response = request_context.get(profile_url, timeout=http_request_timeout_ms)
        logger.debug(f"Lightweight /profile fetch took {time_module.time() - start:.2f}s, status: {profile_response.status}")
        logger.debug(f"Profile response Set-Cookie: {profile_response.headers.get('set-cookie', 'none')[:500]}")
    else:
        # Full page navigation with JS execution
        logger.debug(f"Using full page.goto for /profile after {reason}")
        start = time_module.time()
        
        # Navigate and wait for network to be idle
        page.goto(profile_url, wait_until="networkidle", timeout=http_request_timeout_ms)
        logger.debug(f"Full page.goto took {time_module.time() - start:.2f}s")


def clear_user_otp(user_id: str, postgresql: postgresql) -> bool:
    """
    Clear the OTP code from the database after attempting to use it.

    Args:
        user_id: The user ID
        postgresql: Database connection configuration

    Returns:
        bool: True if OTP was cleared, False otherwise
    """
    try:
        connect_params = {
            "host": postgresql["host"],
            "port": postgresql["port"],
            "user": postgresql["user"],
            "password": postgresql["password"],
            "dbname": postgresql["dbname"],
            "sslmode": postgresql["sslmode"],
        }
        
        # Use context managers to ensure connection is always closed
        with psycopg2.connect(**connect_params, cursor_factory=RealDictCursor) as conn:
            with conn.cursor() as cursor:
                query = """
                    UPDATE zoom.users 
                    SET otp = NULL, otp_updated_at = NULL
                    WHERE id = %s
                """
                cursor.execute(query, (user_id,))
                conn.commit()
                
                rows_affected = cursor.rowcount

                if rows_affected > 0:
                    logger.info(f"Cleared OTP from database for user_id: {user_id}")
                    return True
                else:
                    logger.warning(f"No user found to clear OTP for user_id: {user_id}")
                    return False

    except Exception as e:
        logger.error(f"Database error clearing OTP: {str(e)}")
        return False


def main(
    email: str,
    password: str,
    sign_out: bool = False,
    return_cookies_only: bool = False,
    graceful_invalid_user: bool = False,
    graceful_bad_password: bool = False,
    graceful_otp_required: bool = False,
    graceful_account_blocked: bool = False,
    graceful_missing_cookies: bool = False,
    graceful_timeout: bool = False,
    base_url: str = "https://zoom.us",
    browser_type: str = "chromium",
    use_lightweight_profile_fetch: bool = True,
    skip_initial_page_load: bool = True,
    required_cookies: list = ['cred', 'zm_cluster', 'zm_aid', 'zm_haid', '_zm_page_auth'],
    page_load_timeout_ms: int = 10000,
    http_request_timeout_ms: int = 10000,
    debug: bool = False,
    postgresql: Optional[postgresql] = None,
    user_id: Optional[str] = None,
    attempt_otp_challenge: bool = False,
    otp_timeout_seconds: int = 60,
    otp_lookback_seconds: int = 60,
    otp_poll_interval_seconds: int = 2,
):
    """Send POST request to Zoom signin and return cookies.
    
    Args:
        email: Zoom account email
        password: Zoom account password
        sign_out: Whether to sign out after retrieving cookies
        return_cookies_only: Return just cookies list instead of dict with headers
        graceful_invalid_user: If True, return error dict instead of raising on invalid user
        graceful_bad_password: If True, return error dict instead of raising on bad password
        graceful_otp_required: If True, return error dict instead of raising on OTP requirement
        graceful_account_blocked: If True, return error dict instead of raising on account blocked
        graceful_missing_cookies: If True, return error dict instead of raising on missing cookies
        graceful_timeout: If True, return error dict instead of raising on timeout (retryable)
        base_url: Base URL for all Zoom requests (default: "https://zoom.us")
        browser_type: Browser to use - "firefox", "chromium", or "webkit" (default: "chromium")
        use_lightweight_profile_fetch: If True, use lightweight HTTP GET; if False, use full page.goto()
        skip_initial_page_load: If True, skip loading signin page (faster, save ~0.7s) (default: True)
        required_cookies: List of cookie names to validate after login (default: ['cred', 'zm_cluster', 'zm_aid', 'zm_haid', '_zm_page_auth'])
        page_load_timeout_ms: Timeout for initial page load in milliseconds (default: 10000)
        http_request_timeout_ms: Timeout for HTTP requests in milliseconds (default: 10000)
        postgresql: Database configuration TypedDict with host, port, user, dbname, sslmode, password, root_certificate_pem (required if attempt_otp_challenge=True)
        user_id: User ID for OTP lookup (required if attempt_otp_challenge=True)
        attempt_otp_challenge: If True, attempt to automatically solve OTP challenges by polling database (default: False)
        otp_timeout_seconds: Maximum time to wait for OTP to appear in database (default: 60)
        otp_lookback_seconds: How many seconds back to consider OTP as "recent" (default: 60)
        otp_poll_interval_seconds: Time between database polls for OTP in seconds (default: 2)
    
    Returns:
        On success: cookies list or dict with cookies/headers
        On graceful error: dict with success=False, error_type, error_code, error_message, retryable
    
    Raises:
        ZoomInvalidUserError: When user is invalid and graceful_invalid_user=False
        ZoomBadPasswordError: When password is wrong and graceful_bad_password=False
        ZoomOTPRequiredError: When OTP is required and graceful_otp_required=False
        ZoomAccountBlockedError: When account is blocked and graceful_account_blocked=False
        ZoomMissingCookiesError: When required cookies are missing and graceful_missing_cookies=False (retryable)
        ZoomAuthError: For timeout errors (retryable) when graceful_timeout=False, or other authentication errors
    """
    
    # Configure logging
    _configure_logging(debug=debug)
    
    # Start overall timing
    script_start = time_module.time()
    logger.info(f"=== Script started at {time_module.time():.3f} ===")

    # Setup browser context (quiet mode - disable verbose request logging, skip IP check for speed)
    step_start = time_module.time()
    browser_setup = setup(
        cookies=[], 
        browser_type=browser_type, 
        enable_request_logging=False,
        skip_ip_check=True,  # Skip IP lookup - saves ~200-500ms
        skip_user_agent_log=True,  # Skip user agent log - saves ~10-50ms
        debug=debug  # Pass debug flag for detailed timing logs
    )
    context = browser_setup["context"]
    page = browser_setup["page"]
    logger.info(f"⏱️  Browser setup took {time_module.time() - step_start:.2f}s")

    request_context = page.request
    
    # Convert required_cookies to set for efficient lookups
    # Note: '_zm_login_acctype' removed from defaults to allow free accounts to log in
    critical_cookies = set(required_cookies)
    
    # Warn if no cookies will be validated
    if not critical_cookies:
        logger.warning("No required cookies specified - cookie validation will be skipped")

    try:
        # Step 1: Load signin page to establish session cookies (optional - can be skipped for speed)
        if not skip_initial_page_load:
            step_start = time_module.time()
            logger.info("Loading signin page to establish session")
            page.goto(f"{base_url}/signin#/login", timeout=page_load_timeout_ms, wait_until="domcontentloaded")
            logger.info(f"⏱️  Initial page load took {time_module.time() - step_start:.2f}s")
        else:
            logger.debug("Skipping initial page load (skip_initial_page_load=True)")
        
        # Step 2: Check credential type (validates email exists)
        step_start = time_module.time()
        logger.info(f"Checking credential type for {email}")
        cred_response = request_context.post(
            url=f"{base_url}/signin/credential_type",
            form={
                "style": "new",
                "email": email,
                "snsType": "100",
                "captcha": "000000",
            },
            timeout=http_request_timeout_ms,
        )
        
        cred_text = cred_response.text()
        logger.debug(f"Credential type response: {cred_text[:500] if cred_text else '<empty>'}")
        logger.info(f"⏱️  Credential type check took {time_module.time() - step_start:.2f}s")
        
        cred_obj = None
        try:
            if cred_text and cred_text.strip():
                cred_obj = cred_response.json()
        except json.JSONDecodeError as e:
            logger.warning(f"Credential type JSON parse failed: {e}")
        
        # Check for no response
        if cred_obj is None:
            logger.warning("Credential check returned no parseable response")
            return ZoomInvalidUserError(0, "Credential check returned no parseable response").handle(graceful_invalid_user)
        elif not cred_obj.get("status"):
            error_code = cred_obj.get("errorCode")
            error_message = cred_obj.get("errorMessage") or f"Credential check failed with error code {error_code}"
            
            # Any credential check failure is a full stop
            logger.warning(f"Credential check failed for {email}: error {error_code} - {error_message}")
            return ZoomInvalidUserError(error_code, error_message).handle(graceful_invalid_user)
        else:
            # Success - log available auth methods
            auth_list = cred_obj.get("result", {}).get("authList", [])
            logger.info(f"Credential check passed, auth methods: {auth_list}")

        # Step 3: Send signin POST request
        step_start = time_module.time()
        logger.info(f"Logging in with {email}")
        response = request_context.post(
            url=f"{base_url}/signin",
            form={
                "style": "new",
                "keep_me_signin": "false",
                "recaptcha_challenge_field": "",
                "recaptcha_response_field": "",
                "captcha": "000000",
                "email": email,
                "password": password,
                "type": "100",
            },
            timeout=http_request_timeout_ms,
        )

        # Log response details for debugging
        logger.debug(f"Signin response status: {response.status}")
        logger.debug(f"Signin response headers: {dict(response.headers)}")
        
        response_text = response.text()
        logger.debug(f"Signin response body length: {len(response_text) if response_text else 0}")
        logger.debug(f"Signin response body (first 500 chars): {response_text[:500] if response_text else '<empty>'}")
        logger.info(f"⏱️  Signin POST request took {time_module.time() - step_start:.2f}s")

        # Parse JSON response
        response_obj = None
        try:
            if response_text and response_text.strip():
                response_obj = response.json()
                logger.debug(f"Parsed signin response: {response_obj}")
        except json.JSONDecodeError as e:
            logger.debug(f"JSON parse failed: {e}")
            raise ZoomAuthError("parse_error", None, f"Failed to parse signin response: {e}", retryable=True)

        if response_obj is None:
            raise ZoomAuthError("empty_response", None, "Empty response from signin", retryable=True)

        if not response_obj["status"]:
            error_code = response_obj.get("errorCode")
            error_message = response_obj.get("errorMessage", "Unknown error")

            # Invalid user - errorCode 5513
            if error_code == 5513:
                logger.warning(f"Invalid user: {email}")
                return ZoomInvalidUserError(error_code, error_message).handle(graceful_invalid_user)

            # Bad password - errorCode 1002
            if error_code == 1002:
                logger.warning(f"Bad password for {email}")
                return ZoomBadPasswordError(error_code, error_message).handle(graceful_bad_password)

            # Account blocked - errorCode 1019
            if error_code == 1019:
                logger.warning(f"Account blocked for {email}: {error_message}")
                return ZoomAccountBlockedError(error_code, error_message).handle(graceful_account_blocked)

            # Unknown auth error - always raise
            logger.error(f"Signin failed for {email}: Error {error_code} - {error_message}")
            raise ZoomAuthError("unknown", error_code, error_message, retryable=False)

        # Check for OTP requirement - status is true but result is OTP redirect
        result_url = response_obj.get("result", "")
        extra_data = response_obj.get("extraData", {})
        is_login_successful = extra_data.get("isLoginSuccessfulUrl", True)
        
        if "/signin/otp/" in result_url or not is_login_successful:
            logger.warning(f"OTP verification required for {email}")
            
            # Attempt to handle OTP automatically if attempt_otp_challenge is enabled and postgresql is provided
            if attempt_otp_challenge and postgresql:
                # Extract user_id from email if not provided
                if not user_id:
                    logger.info("user_id not provided, attempting to extract from email address")
                    user_id = extract_user_id_from_email(email)
                    
                    if not user_id:
                        logger.error(f"Could not extract user_id from email address: {email}")
                        return ZoomOTPRequiredError().handle(graceful_otp_required)
                    
                    logger.info(f"Extracted user_id '{user_id}' from email address")
                
                # Now proceed with OTP handling using the user_id
                if user_id:
                    try:
                        logger.info("Attempting to handle OTP verification automatically")
                        
                        # Extract the code directly from the result_url (no need to navigate)
                        # result_url should be something like "/signin/otp/verify_help?code=123..."
                        otp_url = result_url if result_url.startswith("http") else f"{base_url}{result_url}"
                        parsed_url = urlparse(otp_url)
                        query_params = parse_qs(parsed_url.query)
                        code = query_params.get("code", [None])[0]
                        
                        if not code:
                            logger.error(f"No verification code found in result URL: {result_url}")
                            return ZoomOTPRequiredError().handle(graceful_otp_required)
                        
                        logger.info(f"Extracted verification code from result URL")
                        
                        # Poll for the OTP from database (lookup by user_id)
                        logger.info(f"Polling database for OTP (timeout: {otp_timeout_seconds}s, lookback: {otp_lookback_seconds}s, poll interval: {otp_poll_interval_seconds}s)")
                        otp = wait_for_recent_otp(user_id, postgresql, timeout=otp_timeout_seconds, lookback_seconds=otp_lookback_seconds, poll_interval=otp_poll_interval_seconds)
                        
                        if not otp:
                            logger.error(f"Failed to retrieve OTP within {otp_timeout_seconds}s timeout (lookback window: {otp_lookback_seconds}s)")
                            return ZoomOTPRequiredError().handle(graceful_otp_required)
                        
                        logger.info(f"Retrieved OTP from database")
                        
                        # Clear OTP from database before attempting to use it
                        clear_user_otp(user_id, postgresql)
                        
                        # Make direct API call to verify OTP
                        logger.info("Making OTP verification API call")
                        verify_response = request_context.post(
                            url=f"{base_url}/signin/otp/verify",
                            form={
                                "code": code,
                                "otp": otp,
                                "keep_me_signin": "true",
                                "from": "",
                            },
                            timeout=http_request_timeout_ms,
                        )
                        
                        # Parse the response
                        verify_response_text = verify_response.text()
                        logger.debug(f"OTP verify response status: {verify_response.status}")
                        logger.debug(f"OTP verify response body: {verify_response_text[:500] if verify_response_text else '<empty>'}")
                        
                        verify_response_obj = None
                        try:
                            if verify_response_text and verify_response_text.strip():
                                verify_response_obj = verify_response.json()
                                logger.debug(f"Parsed OTP verify response: {verify_response_obj}")
                        except json.JSONDecodeError as e:
                            logger.error(f"Failed to parse OTP verify response as JSON: {str(e)}")
                            return ZoomOTPRequiredError().handle(graceful_otp_required)
                        
                        # Check for errors in the response
                        if verify_response_obj is None:
                            logger.error("OTP verify response is empty")
                            return ZoomOTPRequiredError().handle(graceful_otp_required)
                        
                        if not verify_response_obj.get("status"):
                            error_code = verify_response_obj.get("errorCode")
                            error_message = verify_response_obj.get("errorMessage", "Unknown error")
                            logger.error(f"OTP verification failed - Code: {error_code}, Message: {error_message}")
                            return ZoomOTPRequiredError().handle(graceful_otp_required)
                        
                        # OTP verification successful - continue to profile fetch
                        logger.info("OTP verification successful via API")
                    
                    except ZoomOTPRequiredError:
                        # Re-raise OTP errors
                        raise
                    except Exception as e:
                        logger.error(f"Error during OTP handling: {str(e)}", exc_info=debug)
                        return ZoomOTPRequiredError().handle(graceful_otp_required)
                else:
                    # user_id extraction failed (shouldn't reach here due to check above, but just in case)
                    logger.error("user_id is still None after extraction attempt - this should not happen")
                    return ZoomOTPRequiredError().handle(graceful_otp_required)
            else:
                # OTP challenge not attempted (attempt_otp_challenge=False or postgresql not provided)
                # Use normal error handling based on graceful_otp_required flag
                if not attempt_otp_challenge:
                    logger.info("OTP verification required but attempt_otp_challenge=False - using normal error handling")
                elif not postgresql:
                    logger.warning("OTP verification required but postgresql not provided - cannot handle automatically")
                
                return ZoomOTPRequiredError().handle(graceful_otp_required)

        logger.info("Login succeeded, completing authentication flow")
        
        # Fetch profile to ensure all cookies are set
        step_start = time_module.time()
        fetch_profile(
            page, 
            request_context,
            base_url,
            use_lightweight=use_lightweight_profile_fetch,
            reason="authentication",
            http_request_timeout_ms=http_request_timeout_ms
        )
        logger.info(f"⏱️  Profile fetch took {time_module.time() - step_start:.2f}s")
        
        # Get cookies after profile fetch
        cookies = context.cookies()
        
        # Validate required cookies if any are specified
        if critical_cookies:
            # Retry profile fetch if cookies are missing (handles intermittent Set-Cookie header issues)
            max_profile_retries = 3
            profile_retry_delay_ms = 200  # 200ms between profile fetch retries
            
            for profile_attempt in range(max_profile_retries):
                cookie_names = {c['name'] for c in cookies}
                missing = critical_cookies - cookie_names
                
                if not missing:
                    # Success - all critical cookies present
                    logger.debug(f"Got {len(cookies)} cookies: {sorted(cookie_names)}")
                    break
                
                if profile_attempt < max_profile_retries - 1:
                    # Not last attempt - wait and retry profile fetch
                    logger.warning(f"Profile fetch attempt {profile_attempt + 1}/{max_profile_retries}: missing cookies {missing}, retrying profile fetch in {profile_retry_delay_ms}ms...")
                    time.sleep(profile_retry_delay_ms / 1000.0)
                    
                    # Retry profile fetch
                    step_start = time_module.time()
                    fetch_profile(
                        page, 
                        request_context,
                        base_url,
                        use_lightweight=use_lightweight_profile_fetch,
                        reason="authentication retry",
                        http_request_timeout_ms=http_request_timeout_ms
                    )
                    logger.info(f"⏱️  Profile fetch retry took {time_module.time() - step_start:.2f}s")
                    cookies = context.cookies()
                else:
                    # Last attempt failed - return error
                    logger.warning(f"Missing critical cookies after {max_profile_retries} profile fetch attempts: {missing}")
                    return ZoomMissingCookiesError(missing).handle(graceful_missing_cookies)
        else:
            # No cookies to validate - just log what we got
            logger.debug(f"Got {len(cookies)} cookies (validation skipped): {sorted([c['name'] for c in cookies])}")

        # Sign out if requested
        if sign_out:
            step_start = time_module.time()
            request_context.get(f"{base_url}/logout", timeout=http_request_timeout_ms)
            logger.info(f"⏱️  Sign out took {time_module.time() - step_start:.2f}s")

        total_time = time_module.time() - script_start
        logger.info(f"=== Script completed successfully in {total_time:.2f}s ===")
        
        if return_cookies_only:
            return cookies
        else:
            return {
                "cookies": cookies,
                "headers": response.headers
            }

    except ZoomAuthError:
        # Re-raise our specific auth errors (already logged above)
        raise

    except PlaywrightTimeoutError as e:
        # Timeout errors are retryable - Zoom might be slow/overloaded
        logger.error(f"Timeout during signin for {email}: {str(e)}")
        return ZoomAuthError("timeout", None, f"Request timeout: {str(e)}", retryable=True).handle(graceful_timeout)

    except Exception as e:
        logger.error(f"Error during signin for {email}: {str(e)}")
        raise

    finally:
        # Cleanup
        context.close()
        browser_setup["browser"].close()
        if browser_setup.get("playwright"):
            browser_setup["playwright"].stop()
