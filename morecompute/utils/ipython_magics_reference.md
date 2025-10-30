# IPython Magic Commands Reference

## Line Magics (%)

### Alias & Command Management
- **%alias**: Define system command aliases. Syntax: `%alias name cmd`. Supports `%l` for whole line and `%s` for parameters.
- **%alias_magic**: Create aliases for existing magics with optional parameters using `-l`, `-c`, `-p` flags.
- **%unalias**: Remove a defined alias.
- **%rehashx**: Update alias table with all executable files in $PATH.

### Directory Navigation
- **%cd**: Change working directory. Maintains history in `_dh`. Supports bookmarks via `-b` flag.
- **%pwd**: Return current working directory path.
- **%dhist**: Print directory visit history. Accepts ranges: `%dhist n` shows last n entries.
- **%dirs**: Return current directory stack.
- **%pushd**: Place current directory on stack and change directory.
- **%popd**: Change to directory popped from top of stack.
- **%bookmark**: Manage bookmarks. Commands: `-l` (list), `-d name` (delete), `-r` (remove all).

### History & Session Management
- **%history**: Print input history with options: `-n` (line numbers), `-o` (outputs), `-p` (python prompts), `-t` (translated).
- **%recall / %rep**: Repeat previous commands or place history on input line for editing.
- **%rerun**: Re-run previous input with options: `-l n` (last n lines), `-g pattern` (search history).
- **%load**: Load code from files, URLs, history ranges, or macros. Options: `-r` (lines), `-s` (symbols), `-y` (no confirmation).
- **%loadpy**: Alias for %load (deprecated naming).
- **%save**: Save lines or macros to file. Options: `-r` (raw), `-f` (force), `-a` (append).

### Code Execution & Profiling
- **%run**: Execute Python scripts or notebooks. Options: `-n`, `-i`, `-e`, `-t` (timing), `-d` (debug), `-p` (profile).
- **%prun**: Profile code execution. Options: `-l` (limit output), `-r` (return stats), `-s` (sort key).
- **%time**: Time single statement execution. Shows CPU and wall clock times.
- **%timeit**: Time statement execution using timeit module. Options: `-n` (iterations), `-r` (repeats), `-q` (quiet).

### Debugging & Error Handling
- **%debug**: Activate interactive debugger. Option: `--breakpoint FILE:LINE` to set breakpoint.
- **%pdb**: Toggle automatic pdb debugger on exceptions. Use as toggle or with on/off values.
- **%tb**: Print last traceback with optional mode specification (Plain, Context, Verbose, Minimal).
- **%xmode**: Switch exception handler modes (Plain, Context, Verbose, Minimal).

### Editing & Code Inspection
- **%edit / %ed**: Open editor for code creation/modification. Options: `-n` (line number), `-p` (previous), `-r` (raw), `-x` (no execute).
- **%pdef**: Print callable object's signature or class constructor info.
- **%pdoc**: Print object or class docstring.
- **%pfile**: Print file containing object definition with syntax highlighting.
- **%pinfo / %pinfo2**: Detailed object information (`?` and `??` equivalents).
- **%psource**: Print source code through pager.
- **%psearch**: Search namespaces by wildcard. Options: `-a` (include underscore), `-i/-c` (case), `-e/-s` (exclude/search namespace).
- **%pycat**: Show syntax-highlighted file. Accepts local files, URLs, or history ranges.

### Environment & Variables
- **%env**: Get/set environment variables. Syntax: `%env var`, `%env var=val`, `%env var=$val`.
- **%set_env**: Set environment variables with Python expansion support.
- **%who / %who_ls**: List interactive variables with optional type filtering.
- **%whos**: Like %who but with additional variable information (type, size, shape).

### Namespace Management
- **%reset**: Clear namespace. Options: `-f` (force), `-s` (soft), `--aggressive`. Parameters: `in`, `out`, `dhist`, `array`.
- **%reset_selective**: Remove specific variables by regex pattern. Option: `-f` (force).
- **%xdel**: Delete variable from all IPython references. Option: `-n` (delete by name).

### Logging
- **%logstart**: Start session logging. Modes: append, backup, global, over, rotate. Options: `-o` (output), `-r` (raw), `-t` (timestamps), `-q` (quiet).
- **%logon / %logoff**: Restart or temporarily stop logging.
- **%logstate**: Print logging system status.
- **%logstop**: Fully stop logging and close file.

### System Interaction
- **%system / %sx**: Execute shell command and capture output as list. Similar to `!!` shorthand.
- **%sc**: Shell capture (deprecated). Use `var = !command` instead.

### Configuration & Help
- **%config**: Configure IPython settings. Usage: `%config Class.trait=value`.
- **%magic**: Print magic function system information with format options.
- **%lsmagic**: List currently available magic functions.
- **%quickref**: Display quick reference sheet.
- **%colors**: Switch color scheme globally (e.g., `%colors nocolor`).

### Advanced Features
- **%automagic**: Toggle magic calls without `%` prefix. Values: on/off, 1/0, True/False.
- **%autocall**: Make functions callable without parentheses. Modes: 0 (off), 1 (smart), 2 (always).
- **%autoawait**: Control asynchronous code runner. Values: False/True/asyncio/curio/trio/sync.
- **%load_ext / %reload_ext / %unload_ext**: Manage IPython extensions by module name.
- **%macro**: Define macro from input history ranges for re-execution.
- **%gui**: Enable GUI event loop integration (wx, qt, gtk, tk, osx).
- **%matplotlib**: Setup matplotlib for interactive use. Options: `-l` (list backends).
- **%pylab**: Load numpy and matplotlib. Option: `--no-import-all`.
- **%pastebin**: Upload code to dpaste.com. Options: `-d` (description), `-e` (expiration days).
- **%notebook**: Export IPython history to notebook file.
- **%conda / %mamba / %micromamba / %pip / %uv**: Run package managers within kernel.
- **%code_wrap**: Define code transformer. Options: `--remove`, `--list`, `--list-all`.
- **%doctest_mode**: Toggle doctest-compatible mode (classic prompts, plain exceptions).
- **%page**: Pretty print object through pager. Option: `-r` (raw string).
- **%killbgscripts**: Kill all background processes started by %%script.
- **%pprint**: Toggle pretty printing on/off.
- **%precision**: Set floating point display precision (integer or format string).

## Cell Magics (%%)

### Code Execution
- **%%python / %%python2 / %%python3**: Run cell with specified Python version in subprocess.
- **%%pypy**: Run cell with PyPy interpreter.
- **%%bash / %%sh**: Run cell as bash/sh script in subprocess.
- **%%perl / %%ruby**: Run cell with Perl/Ruby in subprocess.
- **%%script**: Execute cell via specified shell command. Options: `--no-raise-error`, `--proc PROC`, `--bg` (background), `--err ERR`, `--out OUT`.

### Output & Rendering
- **%%capture**: Capture stdout, stderr, and display output. Options: `--no-stderr`, `--no-stdout`, `--no-display`. Stores in `CapturedIO` object.
- **%%html**: Render cell as HTML block. Option: `--isolated` (render in iframe).
- **%%markdown**: Render cell as Markdown text.
- **%%latex**: Render cell as LaTeX (subset supported by MathJax in Jupyter).
- **%%svg**: Render cell as SVG literal.
- **%%javascript / %%js**: Run cell as JavaScript (pending deprecation as of IPython 8.0).

### File Operations
- **%%writefile**: Write cell contents to file. Option: `-a` / `--append` to append instead of overwrite.

### Profiling
- **%%prun**: Profile cell code execution using Python profiler with same options as line magic `%prun`.
- **%%timeit**: Time cell execution. Options: `-n` (iterations), `-r` (repeats), `-q` (quiet), `-o` (return TimeitResult), `-v` (save to variable).

## Priority Implementation for Colab Compatibility

### High Priority (used in most Colab notebooks)
1. **%%capture** - Critical for suppressing verbose installation output
2. **%%time** / **%%timeit** - Very common for benchmarking
3. **%%writefile** - Common for creating config files
4. **%pip** - Package management (already have via shell commands)
5. **%env** - Environment variable management
6. **%who** / **%whos** - Variable inspection

### Medium Priority
1. **%%bash** / **%%sh** - Alternative to ! shell commands
2. **%%html** / **%%markdown** - Rendering in notebooks
3. **%cd** / **%pwd** - Directory navigation (already implemented)
4. **%ls** - File listing (already implemented)
5. **%load** - Load external code

### Lower Priority (specialized use cases)
- Debugging magics (%debug, %pdb)
- Profiling magics (%prun, %%prun)
- History management
- Extension management
