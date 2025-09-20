import click
import os
import webbrowser
import time
from threading import Thread
from .server import NotebookServer
from .notebook import NotebookHandler


@click.command()
@click.argument('file_or_command', required=False, default='new')
@click.option('--port', '-p', default=8888, help='Port to run the server on')
@click.option('--host', '-h', default='localhost', help='Host to run the server on')
@click.option('--no-browser', is_flag=True, help='Do not open browser automatically')
def main(file_or_command, port, host, no_browser):
    """
    MoreCompute Interactive Notebook
    
    Usage:
        kernal_run new                 # Create a new notebook
        kernal_run notebook.py         # Open existing Python file
        kernal_run notebook.ipynb      # Open existing Jupyter notebook
    """
    
    if file_or_command == 'new':
        # Create a new notebook
        notebook_file = None
        print("Creating new notebook...")
    else:
        # Open existing file
        if not os.path.exists(file_or_command):
            click.echo(f"Error: File '{file_or_command}' not found.")
            return
        
        if not file_or_command.endswith(('.py', '.ipynb')):
            click.echo(f"Error: File '{file_or_command}' must be a .py or .ipynb file.")
            return
            
        notebook_file = os.path.abspath(file_or_command)
        print(f"Opening notebook: {notebook_file}")
    
    # Start the server
    server = NotebookServer(host=host, port=port)
    
    # Set the current notebook file
    if notebook_file:
        server.set_notebook_file(notebook_file)
    
    # Start server in a separate thread
    server_thread = Thread(target=server.run, daemon=True)
    server_thread.start()
    
    # Wait a moment for server to start
    time.sleep(1)
    
    # Open browser
    url = f"http://{host}:{port}"
    print(f"MoreCompute notebook server running at: {url}")
    
    if not no_browser:
        webbrowser.open(url)
    
    try:
        # Keep the main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down MoreCompute...")
        server.shutdown()


if __name__ == '__main__':
    main()
