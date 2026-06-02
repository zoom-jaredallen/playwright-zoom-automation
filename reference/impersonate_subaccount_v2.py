from f.lib_zoom.web_utilities.utilities import setup
import logging as logger
logger.basicConfig(level=logger.INFO)

def check_if_already_impersonating(page_content):
    """Check if we're already impersonating by looking for 'Not a master account' text."""
    return "Not a master account" in page_content

def validate_required_cookies(cookies):
    """Validate that required cookies are present."""
    required_cookies = {'cred', '_zm_page_auth', 'zm_aid', 'zm_cluster', 'zm_haid', '_zm_login_acctype'}
    
    # Extract cookie names from the cookies list
    cookie_names = set()
    for cookie in cookies:
        if isinstance(cookie, dict) and 'name' in cookie:
            cookie_names.add(cookie['name'])
    
    # Check for missing cookies
    missing_cookies = required_cookies - cookie_names
    if missing_cookies:
        raise ValueError(f"Missing required cookies: {', '.join(sorted(missing_cookies))}")

def main(cookies: list, subaccount_id: str, debug: bool = False, return_cookies_only: bool = False):
    """Navigate to subaccount and return updated cookies/headers."""

    # Validate required parameters
    if not subaccount_id or not subaccount_id.strip():
        raise ValueError("subaccount_id is required and cannot be blank")
    if not cookies:
        raise ValueError("cookies list is required and cannot be empty")
    
    # Validate required cookies
    validate_required_cookies(cookies)

    # Setup browser context
    browser_setup = setup(
        cookies=cookies, 
        browser_type="firefox",
        debug_logs=debug
    )
    context = browser_setup["context"]
    page = browser_setup["page"]
    request_context = page.request
    response = None

    try:
        subaccount_url = f"https://zoom.us/account/sub/{subaccount_id}/login"

        logger.info(f"Navigating to {subaccount_url}")
        response = request_context.get(subaccount_url)

        logger.info(f"Landed on {response.url}")
        
        # Check if we got a successful response
        if not response.ok:
            raise Exception(f"Failed to access subaccount. Status: {response.status}")

        # Get page content to check for impersonation status
        page.goto(response.url)
        page_content = page.content()
        
        # Check if we're already impersonating this account
        is_already_impersonating = check_if_already_impersonating(page_content)
        if is_already_impersonating:
            logger.info("Already impersonating an account (found 'Not a master account' text)")
            
            # Return original cookies since we're already impersonating
            if return_cookies_only:
                return cookies
            else:
                return {
                    "cookies": cookies,
                    "headers": dict(response.headers),
                    "status": response.status,
                    "final_url": response.url
                }
        else:
            logger.info("Not currently impersonating an account")

        # Verify final URL contains submanage pattern
        if "submanage" not in response.url:

            if "signin" in response.url:
                raise Exception("Kicked back to sign-in page, check bot detection")
            
            raise Exception(f"Failed to impersonate subaccount. Make sure this subaccount belongs to you. Final URL: {response.url}")

        # Get updated cookies from context
        updated_cookies = context.cookies(urls=["https://zoom.us", "https://zoom.com"])

        if return_cookies_only:
            return updated_cookies
        else:
            return {
                "cookies": updated_cookies,
                "headers": dict(response.headers),
                "status": response.status,
                "final_url": response.url
            }
    
    except Exception as e:
        # Log headers and cookies on failure
        if response:
            logger.error(f"Response headers: {dict(response.headers)}")
        
        try:
            updated_cookies = context.cookies(urls=["https://zoom.us", "https://zoom.com"])
            logger.error(f"Current cookies: {updated_cookies}")
        except Exception:
            logger.error("Failed to retrieve cookies")
        
        raise e

    finally:
        # Cleanup
        context.close()
        browser_setup["browser"].close()
        if browser_setup.get("playwright"):
            browser_setup["playwright"].stop()