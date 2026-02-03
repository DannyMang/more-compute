"""Claude AI service for MORECOMPUTE notebook assistant."""

import re
from typing import AsyncGenerator, Optional
from dataclasses import dataclass, field

try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False


# Context window management constants
MAX_CONTEXT_CHARS = 100_000      # ~25k tokens for notebook context
MAX_CELL_SOURCE_CHARS = 5_000   # Per-cell source code cap
MAX_CELL_OUTPUT_CHARS = 500     # Per-cell output cap (outputs can be huge)
MAX_HISTORY_MESSAGES = 20       # Cap conversation history
MAX_HISTORY_CHARS = 30_000      # Total history character budget


@dataclass
class ProposedEdit:
    """Represents a proposed edit to a notebook cell."""
    cell_index: int
    original_code: str
    new_code: str
    explanation: str


@dataclass
class ClaudeContext:
    """Context information sent to Claude."""
    cells: list[dict]
    focused_cell: int = -1  # Index of currently focused cell (-1 = none)
    gpu_info: Optional[dict] = None
    metrics: Optional[dict] = None
    packages: Optional[list[dict]] = None


class ClaudeService:
    """Service for interacting with Claude API."""

    SYSTEM_PROMPT = """You are a helpful AI assistant integrated into MORECOMPUTE, a Python notebook interface for GPU computing.

You help users with:
- Writing and debugging Python code
- Understanding GPU/CUDA operations
- Optimizing code for GPU execution
- Explaining errors and suggesting fixes
- Data science and machine learning tasks

IMPORTANT: When you want to suggest code changes to a cell, use this exact format:

```edit:CELL_INDEX
NEW CODE HERE
```

Where CELL_INDEX is the 0-based index of the cell to modify. For example, to modify cell 0:

```edit:0
print("Hello, world!")
```

You can propose multiple edits in a single response. The user will see a visual diff and can accept or reject each edit.

When providing code suggestions:
- Be concise and focused
- Explain what the code does
- Mention any potential issues or improvements
- Consider GPU memory constraints when relevant

Current notebook context will be provided with each message."""

    # Available models
    MODELS = {
        "sonnet": "claude-sonnet-4-20250514",
        "haiku": "claude-haiku-4-20250514",
        "opus": "claude-opus-4-5-20251101",  # Opus 4.5
    }

    def __init__(self, api_key: str, model: str = "sonnet"):
        if not ANTHROPIC_AVAILABLE:
            raise ImportError("anthropic package is not installed. Run: pip install anthropic")
        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self.model = self.MODELS.get(model, self.MODELS["sonnet"])

    def _prioritize_cells(self, cells: list[dict], focused_cell: int = -1) -> list[tuple[int, dict, int]]:
        """
        Prioritize cells for context inclusion.
        Returns list of (index, cell, priority) tuples, sorted by priority (higher = more important).

        Priority levels:
        - 100: Focused cell
        - 80: Cells with errors
        - 60: Recent cells (last 5)
        - 40: Cells with outputs
        - 20: Other cells
        """
        prioritized = []
        num_cells = len(cells)

        for i, cell in enumerate(cells):
            priority = 20  # Base priority

            # Focused cell gets highest priority
            if i == focused_cell:
                priority = 100
            # Cells with errors get high priority
            elif cell.get("error") or any(
                o.get("output_type") == "error" for o in cell.get("outputs", [])
            ):
                priority = 80
            # Recent cells (last 5) get medium-high priority
            elif i >= num_cells - 5:
                priority = 60
            # Cells with outputs get medium priority
            elif cell.get("outputs"):
                priority = 40

            prioritized.append((i, cell, priority))

        # Sort by priority (descending), then by index (ascending for tie-breaking)
        prioritized.sort(key=lambda x: (-x[2], x[0]))
        return prioritized

    def _format_cell(self, index: int, cell: dict, is_focused: bool = False) -> str:
        """Format a single cell for context, with truncation."""
        parts = []
        cell_type = cell.get("cell_type", "code")
        source = cell.get("source", "")
        if isinstance(source, list):
            source = "".join(source)

        # Truncate source if needed
        if len(source) > MAX_CELL_SOURCE_CHARS:
            source = source[:MAX_CELL_SOURCE_CHARS] + "\n... [truncated]"

        focused_marker = " (FOCUSED)" if is_focused else ""
        lang = "python" if cell_type == "code" else "markdown"
        parts.append(f"### Cell {index} ({cell_type}){focused_marker}\n```{lang}\n{source}\n```\n")

        # Include outputs (truncated)
        outputs = cell.get("outputs", [])
        if outputs:
            parts.append("**Output:**\n")
            for output in outputs[:3]:  # Max 3 outputs per cell
                output_type = output.get("output_type", "")
                if output_type == "stream":
                    text = output.get("text", "")
                    if isinstance(text, list):
                        text = "".join(text)
                    text = text[:MAX_CELL_OUTPUT_CHARS]
                    if len(output.get("text", "")) > MAX_CELL_OUTPUT_CHARS:
                        text += "\n... [truncated]"
                    parts.append(f"```\n{text}\n```\n")
                elif output_type == "execute_result":
                    data = output.get("data", {})
                    if "text/plain" in data:
                        text = data["text/plain"]
                        if isinstance(text, list):
                            text = "".join(text)
                        text = text[:MAX_CELL_OUTPUT_CHARS]
                        parts.append(f"```\n{text}\n```\n")
                elif output_type == "error":
                    ename = output.get("ename", "Error")
                    evalue = output.get("evalue", "")
                    traceback = output.get("traceback", [])
                    # Include truncated traceback for errors
                    tb_text = "\n".join(traceback[-5:]) if traceback else ""  # Last 5 lines
                    tb_text = tb_text[:1000]  # Cap traceback
                    parts.append(f"**Error: {ename}**: {evalue}\n```\n{tb_text}\n```\n")

        return "".join(parts)

    def build_context_message(self, context: ClaudeContext) -> str:
        """Build a context string from notebook state with budget management."""
        budget = MAX_CONTEXT_CHARS
        parts = []

        # Add cells context with prioritization
        if context.cells:
            parts.append("## Current Notebook Cells\n")
            budget -= len(parts[-1])

            prioritized = self._prioritize_cells(context.cells, context.focused_cell)
            included_cells = []

            for index, cell, priority in prioritized:
                is_focused = (index == context.focused_cell)
                cell_str = self._format_cell(index, cell, is_focused)

                if len(cell_str) <= budget:
                    included_cells.append((index, cell_str))
                    budget -= len(cell_str)
                elif budget > 200:  # Room for truncated version
                    truncated = f"### Cell {index} ({cell.get('cell_type', 'code')}) [content omitted]\n"
                    included_cells.append((index, truncated))
                    budget -= len(truncated)

            # Sort by index for display
            included_cells.sort(key=lambda x: x[0])
            for _, cell_str in included_cells:
                parts.append(cell_str)

            omitted = len(context.cells) - len(included_cells)
            if omitted > 0:
                parts.append(f"\n*({omitted} cells omitted due to context limits)*\n")

        # Add GPU info (compact)
        if context.gpu_info and budget > 500:
            gpu_parts = ["\n## GPU Information\n"]
            gpu_list = context.gpu_info.get("gpu", [])
            if gpu_list:
                for i, gpu in enumerate(gpu_list):
                    util = gpu.get("util_percent", "N/A")
                    mem_used = gpu.get("mem_used", 0) / (1024**3) if gpu.get("mem_used") else 0
                    mem_total = gpu.get("mem_total", 0) / (1024**3) if gpu.get("mem_total") else 0
                    temp = gpu.get("temperature_c", "N/A")
                    gpu_parts.append(f"- GPU {i}: {util}% util, {mem_used:.1f}/{mem_total:.1f}GB, {temp}C\n")
            else:
                gpu_parts.append("No GPU detected\n")

            gpu_str = "".join(gpu_parts)
            if len(gpu_str) <= budget:
                parts.append(gpu_str)
                budget -= len(gpu_str)

        # Add system metrics (compact)
        if context.metrics and budget > 300:
            cpu = context.metrics.get("cpu", {})
            memory = context.metrics.get("memory", {})
            mem_used = memory.get("used", 0) / (1024**3) if memory.get("used") else 0
            mem_total = memory.get("total", 0) / (1024**3) if memory.get("total") else 0
            metrics_str = f"\n## System: CPU {cpu.get('percent', 'N/A')}%, RAM {mem_used:.1f}/{mem_total:.1f}GB\n"
            if len(metrics_str) <= budget:
                parts.append(metrics_str)
                budget -= len(metrics_str)

        # Add relevant packages (compact)
        if context.packages and budget > 200:
            ml_packages = ["torch", "tensorflow", "jax", "numpy", "pandas", "scikit-learn",
                         "transformers", "datasets", "accelerate", "deepspeed"]
            relevant = [p for p in context.packages if p.get("name", "").lower() in ml_packages]
            if relevant:
                pkg_str = "\n## Packages: " + ", ".join(
                    f"{p.get('name')} {p.get('version')}" for p in relevant[:8]
                ) + "\n"
                if len(pkg_str) <= budget:
                    parts.append(pkg_str)

        return "".join(parts)

    def _truncate_history(self, history: list[dict]) -> list[dict]:
        """Truncate conversation history to fit within budget."""
        if not history:
            return []

        # Limit number of messages
        history = history[-MAX_HISTORY_MESSAGES:]

        # Truncate by character count
        truncated = []
        total_chars = 0

        # Process from most recent to oldest
        for msg in reversed(history):
            content = msg.get("content", "")
            msg_chars = len(content)

            if total_chars + msg_chars <= MAX_HISTORY_CHARS:
                truncated.insert(0, msg)
                total_chars += msg_chars
            elif total_chars < MAX_HISTORY_CHARS:
                # Truncate this message to fit remaining budget
                remaining = MAX_HISTORY_CHARS - total_chars
                truncated.insert(0, {
                    "role": msg["role"],
                    "content": content[:remaining] + "\n... [earlier content truncated]"
                })
                break
            else:
                break

        return truncated

    async def stream_response(
        self,
        message: str,
        context: ClaudeContext,
        history: Optional[list[dict]] = None,
        max_tokens: int = 4096,
        model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """Stream a response from Claude.

        Args:
            model: One of "sonnet", "haiku", "opus". Defaults to instance model.
        """
        messages = []

        # Add truncated history
        if history:
            truncated_history = self._truncate_history(history)
            for msg in truncated_history:
                messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })

        # Build context and add to user message
        context_str = self.build_context_message(context)
        user_content = f"{context_str}\n\n---\n\n**User Question:**\n{message}"

        messages.append({
            "role": "user",
            "content": user_content
        })

        # Use provided model or fall back to instance model
        model_id = self.MODELS.get(model, self.model) if model else self.model

        async with self.client.messages.stream(
            model=model_id,
            max_tokens=max_tokens,
            system=self.SYSTEM_PROMPT,
            messages=messages
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def get_response(
        self,
        message: str,
        context: ClaudeContext,
        history: Optional[list[dict]] = None,
        max_tokens: int = 4096
    ) -> str:
        """Get a complete response from Claude (non-streaming)."""
        full_response = []
        async for chunk in self.stream_response(message, context, history, max_tokens):
            full_response.append(chunk)
        return "".join(full_response)

    @staticmethod
    def parse_edit_blocks(response: str, cells: list[dict]) -> list[ProposedEdit]:
        """Parse edit blocks from Claude's response.

        Format: ```edit:CELL_INDEX
        NEW CODE
        ```
        """
        edits = []

        # Pattern to match edit blocks
        pattern = r'```edit:(\d+)\n(.*?)```'
        matches = re.findall(pattern, response, re.DOTALL)

        for cell_index_str, new_code in matches:
            cell_index = int(cell_index_str)

            # Validate cell index
            if 0 <= cell_index < len(cells):
                original_code = cells[cell_index].get("source", "")
                if isinstance(original_code, list):
                    original_code = "".join(original_code)

                # Extract explanation (text before the edit block)
                explanation = ""
                edit_start = response.find(f"```edit:{cell_index}")
                if edit_start > 0:
                    # Get text before this edit block
                    prev_text = response[:edit_start].strip()
                    # Get the last paragraph as explanation
                    paragraphs = prev_text.split("\n\n")
                    if paragraphs:
                        explanation = paragraphs[-1].strip()

                edits.append(ProposedEdit(
                    cell_index=cell_index,
                    original_code=original_code.strip(),
                    new_code=new_code.strip(),
                    explanation=explanation
                ))

        return edits

    @staticmethod
    def remove_edit_blocks(response: str) -> str:
        """Remove edit blocks from response for display purposes."""
        pattern = r'```edit:\d+\n.*?```'
        return re.sub(pattern, '[Edit proposed - see inline diff]', response, flags=re.DOTALL)
