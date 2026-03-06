# -*- coding: utf-8 -*-
"""
Encryption utilities for sensitive database values.
Uses Fernet symmetric encryption (AES-128-CBC with HMAC).
"""

import os
import logging

logger = logging.getLogger('pos-server')

_fernet = None
_encryption_available = False

def _get_fernet():
    """Lazy-initialize Fernet cipher from environment variable."""
    global _fernet, _encryption_available
    if _fernet is not None:
        return _fernet
    key = os.environ.get('POS_ENCRYPTION_KEY', '')
    if not key:
        logger.warning("WARNING: POS_ENCRYPTION_KEY not set. Generating ephemeral key (will change on restart). Set it in .env for production!")
        try:
            from cryptography.fernet import Fernet
            key = Fernet.generate_key().decode('utf-8')
            os.environ['POS_ENCRYPTION_KEY'] = key
        except ImportError:
            _encryption_available = False
            return None
    try:
        from cryptography.fernet import Fernet
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
        _encryption_available = True
        logger.info("Database encryption initialized successfully")
        return _fernet
    except Exception as e:
        logger.error(f"Failed to initialize encryption: {e}")
        _encryption_available = False
        return None


def encrypt_value(plaintext):
    """Encrypt a string value. Returns prefixed ciphertext or plaintext if encryption unavailable."""
    if not plaintext:
        return plaintext
    f = _get_fernet()
    if not f:
        return plaintext
    try:
        encrypted = f.encrypt(plaintext.encode('utf-8')).decode('utf-8')
        return f"ENC:{encrypted}"
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        return plaintext


def decrypt_value(stored_value):
    """Decrypt a stored value. Handles both encrypted (ENC: prefix) and plaintext values."""
    if not stored_value:
        return stored_value
    if not stored_value.startswith('ENC:'):
        return stored_value  # Not encrypted, return as-is
    f = _get_fernet()
    if not f:
        logger.warning("Cannot decrypt value: POS_ENCRYPTION_KEY not set")
        return stored_value
    try:
        ciphertext = stored_value[4:]  # Remove 'ENC:' prefix
        return f.decrypt(ciphertext.encode('utf-8')).decode('utf-8')
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        return stored_value


def is_encryption_available():
    """Check if encryption is configured and available."""
    _get_fernet()
    return _encryption_available


# Sensitive setting keys that should be encrypted
SENSITIVE_KEYS = {
    'auth_secret',
    'gdrive_client_id',
    'gdrive_client_secret',
    'gdrive_access_token',
    'gdrive_refresh_token',
}
