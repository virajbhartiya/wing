"""Distribution configuration validation; no private credentials belong in this file."""
import base64
from urllib.parse import urlparse

def validate(config):
    if not isinstance(config, dict):
        raise ValueError('Release configuration must be an object')
    url = config.get('feedURL', '')
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.hostname in {'localhost', 'example.com', 'example.invalid'}:
        raise ValueError('An owned HTTPS update feed URL is required')
    try:
        key = base64.b64decode(config.get('publicEDKey', ''), validate=True)
    except Exception as error:
        raise ValueError('A valid Sparkle public Ed25519 key is required') from error
    if len(key) != 32:
        raise ValueError('Sparkle public Ed25519 key must be 32 bytes')
    return {'SUFeedURL': url, 'SUPublicEDKey': config['publicEDKey'],
            'SUVerifyUpdateBeforeExtraction': True, 'SURequireSignedFeed': True,
            'SUEnableAutomaticChecks': True, 'SUScheduledCheckInterval': 14400}
