import re
import traceback
from typing import Dict, Any, List

"""

most of  this is ai-generated, but I would like custom error handling for most general errors

imagine like user does not know pip is ran with !pip install, and just runs pip install,

it would be nice just to have a custom error message pointing user to use !pip rather than just fail, etc



"""



def create_enhanced_error_info(exception: Exception, traceback_lines: List[str]) -> Dict[str, Any]:
    """
    Create enhanced error information with better formatting and suggestions

    Args:
        exception: The caught exception
        traceback_lines: List of traceback lines

    Returns:
        Enhanced error dictionary with suggestions and formatting
    """
    error_type = type(exception).__name__
    error_message = str(exception)

    # Check for specific error types and provide custom handling
    if _is_pip_related_error(error_message, traceback_lines):
        return _create_pip_error_info(error_type, error_message, traceback_lines)
    elif _is_import_error(error_type, error_message):
        return _create_import_error_info(error_type, error_message, traceback_lines)
    elif _is_file_not_found_error(error_type, error_message):
        return _create_file_error_info(error_type, error_message, traceback_lines)
    else:
        return _create_generic_enhanced_error(error_type, error_message, traceback_lines)


def _is_pip_related_error(error_message: str, traceback_lines: List[str]) -> bool:
    """Check if the error is related to pip operations"""
    pip_indicators = [
        "pip install",
        "pip uninstall", 
        "pip show",
        "pip list",
        "subprocess.*pip",
        "ModuleNotFoundError.*pip",
        "No module named 'pip'"
    ]
    
    combined_text = error_message + " " + " ".join(traceback_lines)
    
    # Check for direct pip command syntax errors (most common case)
    if "SyntaxError" in error_message and "pip install" in combined_text:
        return True
        
    return any(re.search(indicator, combined_text, re.IGNORECASE) for indicator in pip_indicators)


def _is_import_error(error_type: str, error_message: str) -> bool:
    """Check if this is a module import error"""
    return error_type in ["ModuleNotFoundError", "ImportError"]


def _is_file_not_found_error(error_type: str, error_message: str) -> bool:
    """Check if this is a file not found error"""
    return error_type == "FileNotFoundError"


def _create_pip_error_info(error_type: str, error_message: str, traceback_lines: List[str]) -> Dict[str, Any]:
    """Create custom error info for pip-related errors"""
    
    # Extract package name if possible
    package_name = _extract_package_name_from_pip_command(error_message, traceback_lines)
    
    suggestions = []
    enhanced_message = error_message
    
    # Handle direct pip command syntax errors (most common case)
    if "SyntaxError" in error_type and "pip install" in " ".join(traceback_lines):
        enhanced_message = "Cannot run pip commands directly in Python code"
        if package_name:
            suggestions.extend([
                f"Use shell command instead: !pip install {package_name}",
                f"Or use subprocess: subprocess.run(['pip', 'install', '{package_name}'])",
                "Note: pip commands need to be run in shell, not Python"
            ])
        else:
            suggestions.extend([
                "Use shell command instead: !pip install <package_name>",
                "Or use subprocess: subprocess.run(['pip', 'install', '<package_name>'])",
                "Note: pip commands need to be run in shell, not Python"
            ])
    elif "ModuleNotFoundError" in error_type and package_name:
        enhanced_message = f"Package '{package_name}' is not installed"
        suggestions.extend([
            f"Install the package: !pip install {package_name}",
            f"Or use subprocess: subprocess.run(['pip', 'install', '{package_name}'])",
            "Check if the package name is spelled correctly",
            "Verify the package exists on PyPI: https://pypi.org/"
        ])
    elif "pip install" in error_message.lower():
        suggestions.extend([
            "Try using shell command: !pip install <package_name>",
            "Check your internet connection",
            "Verify the package name exists on PyPI",
            "Try upgrading pip: !pip install --upgrade pip"
        ])
    elif "No module named 'pip'" in error_message:
        enhanced_message = "pip is not installed or not found in your Python environment"
        suggestions.extend([
            "Reinstall pip: python -m ensurepip --upgrade",
            "Or download get-pip.py and run: python get-pip.py",
            "Check if you're using the correct Python environment"
        ])
    
    return {
        "ename": "PipError",
        "evalue": enhanced_message,
        "suggestions": suggestions,
        "traceback": _format_traceback(traceback_lines),
        "error_type": "pip_error"
    }


def _create_import_error_info(error_type: str, error_message: str, traceback_lines: List[str]) -> Dict[str, Any]:
    """Create enhanced error info for import errors"""

    # Extract module name
    module_name = _extract_module_name(error_message)

    suggestions = []
    if module_name:
        suggestions.extend([
            f"Install the missing package: !pip install {module_name}",
            "Check if the module name is spelled correctly",
            "Verify the module is in your Python path",
            f"Search for the correct package name: https://pypi.org/search/?q={module_name}"
        ])

    return {
        "ename": error_type,
        "evalue": error_message,
        "suggestions": suggestions,
        "traceback": _format_traceback(traceback_lines),
        "error_type": "import_error"
    }


def _create_file_error_info(error_type: str, error_message: str, traceback_lines: List[str]) -> Dict[str, Any]:
    """Create enhanced error info for file errors"""

    # Extract file path if possible
    file_path = _extract_file_path(error_message)

    suggestions = [
        "Check if the file path is correct",
        "Verify the file exists in the specified location",
        "Check file permissions",
        "Use absolute path instead of relative path"
    ]

    if file_path:
        suggestions.insert(0, f"File not found: {file_path}")

    return {
        "ename": error_type,
        "evalue": error_message,
        "suggestions": suggestions,
        "traceback": _format_traceback(traceback_lines),
        "error_type": "file_error"
    }


def _create_generic_enhanced_error(error_type: str, error_message: str, traceback_lines: List[str]) -> Dict[str, Any]:
    """Create enhanced error info for generic errors"""

    suggestions = _generate_generic_suggestions(error_type, error_message)

    return {
        "ename": error_type,
        "evalue": error_message,
        "suggestions": suggestions,
        "traceback": _format_traceback(traceback_lines),
        "error_type": "generic_error"
    }


def _extract_package_name(error_message: str, traceback_lines: List[str]) -> str:
    """Extract package name from error message or traceback"""
    # Try to find module name in "No module named 'xyz'" pattern
    match = re.search(r"No module named ['\"]([^'\"]+)['\"]", error_message)
    if match:
        return match.group(1)
    
    # Try to find in traceback
    combined_text = " ".join(traceback_lines)
    match = re.search(r"import\s+(\w+)", combined_text)
    if match:
        return match.group(1)
    
    return ""


def _extract_package_name_from_pip_command(error_message: str, traceback_lines: List[str]) -> str:
    """Extract package name from pip install command in traceback"""
    combined_text = error_message + " " + " ".join(traceback_lines)
    
    # Look for "pip install package-name" pattern
    match = re.search(r"pip\s+install\s+([\w-]+)", combined_text)
    if match:
        return match.group(1)
    
    # Fallback to regular package name extraction
    return _extract_package_name(error_message, traceback_lines)


def _extract_module_name(error_message: str) -> str:
    """Extract module name from import error message"""
    match = re.search(r"No module named ['\"]([^'\"]+)['\"]", error_message)
    return match.group(1) if match else ""


def _extract_file_path(error_message: str) -> str:
    """Extract file path from file error message"""
    # Try to find file path in brackets or quotes
    patterns = [
        r"\[Errno \d+\] .+?: '([^']+)'",
        r'"([^"]+)".*not found',
        r"'([^']+)'.*not found"
    ]

    for pattern in patterns:
        match = re.search(pattern, error_message)
        if match:
            return match.group(1)

    return ""


def _generate_generic_suggestions(error_type: str, error_message: str) -> List[str]:
    """Generate helpful suggestions for generic errors"""
    suggestions = []

    if error_type == "SyntaxError":
        suggestions.extend([
            "Check for missing parentheses, brackets, or quotes",
            "Verify proper indentation",
            "Look for typos in keywords or variable names"
        ])
    elif error_type == "NameError":
        suggestions.extend([
            "Check if the variable is defined before use",
            "Verify variable name spelling",
            "Make sure to import required modules"
        ])
    elif error_type == "TypeError":
        suggestions.extend([
            "Check function arguments and their types",
            "Verify object methods and attributes",
            "Check if you're calling a function correctly"
        ])
    elif error_type == "ValueError":
        suggestions.extend([
            "Check input values and their formats",
            "Verify numeric conversions",
            "Check if values are within expected ranges"
        ])
    elif error_type == "KeyError":
        suggestions.extend([
            "Check if the key exists in the dictionary",
            "Use .get() method for safer key access",
            "Verify the key spelling and type"
        ])
    elif error_type == "IndexError":
        suggestions.extend([
            "Check list/array bounds",
            "Verify the index is within range",
            "Check if the list is empty"
        ])
    else:
        suggestions.extend([
            "Check the error message for specific details",
            "Look at the line number in the traceback",
            "Search online for this specific error type"
        ])

    return suggestions


def _format_traceback(traceback_lines: List[str]) -> List[str]:
    """Format traceback lines for better readability"""
    if not traceback_lines:
        return []

    # Remove empty lines and clean up formatting
    formatted_lines = []
    for line in traceback_lines:
        if line.strip():
            formatted_lines.append(line.rstrip())

    # Limit to last 15 lines for readability
    if len(formatted_lines) > 15:
        formatted_lines = ["... (traceback truncated) ..."] + formatted_lines[-15:]

    return formatted_lines


class ErrorUtils:
    """Helper class to generate enhanced error payloads for the frontend."""

    def format_exception(self, exception: Exception) -> Dict[str, Any]:
        """Return enhanced error information for the given exception."""

        formatted_traceback = traceback.format_exception(type(exception), exception, exception.__traceback__)
        cleaned_traceback = [line.rstrip("\n") for line in formatted_traceback]
        return create_enhanced_error_info(exception, cleaned_traceback)
