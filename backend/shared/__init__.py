"""Shared library for the Certificate Generation & Verification backend.

This package is copied into every deployed function package by
``scripts/deploy_functions.sh`` so that each Cloud Run function is
self-contained (a deployed function never sees sibling directories).
"""

__version__ = "1.0.0"
