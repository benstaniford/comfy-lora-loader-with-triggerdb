"""
File ID generation utilities for LoRa files.

Generates fast hash IDs for large files by sampling first/last 1MB and file size,
avoiding the need to read entire multi-GB LoRa model files.
"""
import hashlib
import os


def get_file_id(filepath):
    """
    Generate a SHA1 hash ID for a file based on:
    - File size
    - First 1MB of file content
    - Last 1MB of file content (if file > 1MB)

    This provides a fast unique identifier for large files without
    reading the entire file content.

    Args:
        filepath: Path to the file

    Returns:
        str: Hexadecimal SHA1 hash digest

    Raises:
        FileNotFoundError: If the file doesn't exist
        PermissionError: If the file can't be read
        OSError: If there's an error reading the file
    """
    CHUNK_SIZE = 1024 * 1024  # 1MB

    # Get file size
    file_size = os.path.getsize(filepath)

    # Initialize hash with file size
    hasher = hashlib.sha1()
    hasher.update(str(file_size).encode('utf-8'))

    with open(filepath, 'rb') as f:
        # Read first 1MB
        first_chunk = f.read(CHUNK_SIZE)
        hasher.update(first_chunk)

        # Read last 1MB if file is larger than 1MB
        if file_size > CHUNK_SIZE:
            # Seek to last 1MB
            f.seek(-CHUNK_SIZE, os.SEEK_END)
            last_chunk = f.read(CHUNK_SIZE)
            hasher.update(last_chunk)

    return hasher.hexdigest()


def get_file_id_safe(filepath, fallback=None):
    """
    Safely get file ID with error handling.

    Args:
        filepath: Path to the file
        fallback: Value to return if file ID can't be generated (default: None)

    Returns:
        str or fallback: File ID hash or fallback value if an error occurs
    """
    try:
        return get_file_id(filepath)
    except (FileNotFoundError, PermissionError, OSError) as e:
        print(f"Warning: Could not generate file ID for '{filepath}': {e}")
        return fallback
