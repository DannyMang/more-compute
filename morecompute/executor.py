import sys
import io
import traceback
import threading
import time
from contextlib import redirect_stdout, redirect_stderr
from typing import Dict, Any, Optional


class CellExecutor:
    """Handles execution of notebook cells with proper isolation and output capture"""
    
    def __init__(self):
        self.globals_dict = {"__name__": "__main__"}
        self.execution_count = 0
        self._execution_lock = threading.Lock()
    
    def execute_cell(self, source_code: str) -> Dict[str, Any]:
        """
        Execute a cell and return the result with outputs
        
        Args:
            source_code: Python code to execute
            
        Returns:
            Dict containing execution result, outputs, and error information
        """
        with self._execution_lock:
            self.execution_count += 1
            
            result = {
                "execution_count": self.execution_count,
                "outputs": [],
                "error": None,
                "status": "ok"
            }
            
            if not source_code.strip():
                return result
            
            # Capture stdout and stderr
            stdout_capture = io.StringIO()
            stderr_capture = io.StringIO()
            
            try:
                with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                    # Compile and execute the code
                    compiled_code = compile(source_code, '<cell>', 'exec')
                    exec(compiled_code, self.globals_dict)
                
                # Capture stdout output
                stdout_content = stdout_capture.getvalue()
                if stdout_content:
                    result["outputs"].append({
                        "output_type": "stream",
                        "name": "stdout",
                        "text": stdout_content
                    })
                
                # Capture stderr output
                stderr_content = stderr_capture.getvalue()
                if stderr_content:
                    result["outputs"].append({
                        "output_type": "stream",
                        "name": "stderr",
                        "text": stderr_content
                    })
                
                # Try to capture the result of the last expression
                try:
                    # Split code into lines and check if last line is an expression
                    lines = source_code.strip().split('\n')
                    if lines:
                        last_line = lines[-1].strip()
                        if last_line and not self._is_statement(last_line):
                            # Try to evaluate the last line as an expression
                            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                                expr_result = eval(last_line, self.globals_dict)
                                if expr_result is not None:
                                    result["outputs"].append({
                                        "output_type": "execute_result",
                                        "execution_count": self.execution_count,
                                        "data": {
                                            "text/plain": repr(expr_result)
                                        }
                                    })
                except:
                    # If evaluation fails, ignore it
                    pass
                    
            except Exception as e:
                result["status"] = "error"
                result["error"] = {
                    "ename": type(e).__name__,
                    "evalue": str(e),
                    "traceback": traceback.format_exc().split('\n')
                }
                
                # Also add error as output
                result["outputs"].append({
                    "output_type": "error",
                    "ename": type(e).__name__,
                    "evalue": str(e),
                    "traceback": traceback.format_exc().split('\n')
                })
            
            return result
    
    def _is_statement(self, line: str) -> bool:
        """Check if a line is a statement (vs expression)"""
        statement_keywords = [
            'import', 'from', 'def', 'class', 'if', 'elif', 'else', 'for', 
            'while', 'try', 'except', 'finally', 'with', 'assert', 'del',
            'global', 'nonlocal', 'pass', 'break', 'continue', 'return',
            'raise', 'yield'
        ]
        
        line = line.strip()
        if not line:
            return True
            
        # Check for assignment
        if '=' in line and not any(op in line for op in ['==', '!=', '<=', '>=']):
            return True
            
        # Check for statement keywords
        first_word = line.split()[0]
        return first_word in statement_keywords
    
    def reset_kernel(self):
        """Reset the execution environment"""
        with self._execution_lock:
            self.globals_dict = {"__name__": "__main__"}
            self.execution_count = 0
    
    def get_variables(self) -> Dict[str, str]:
        """Get current variables in the execution environment"""
        variables = {}
        for name, value in self.globals_dict.items():
            if not name.startswith('_') and not callable(value):
                try:
                    variables[name] = repr(value)
                except:
                    variables[name] = "<unprintable>"
        return variables
    
    def interrupt_execution(self):
        """Interrupt current execution (placeholder for future implementation)"""
        # This would require more sophisticated thread management
        # For now, we'll just pass
        pass
