from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import os
import json
import threading
from typing import Optional

from .notebook import NotebookHandler
from .executor import CellExecutor


class NotebookServer:
    """Flask server for the interactive notebook interface"""
    
    def __init__(self, host='localhost', port=8888, debug=False):
        self.host = host
        self.port = port
        self.debug = debug
        self.notebook_handler: Optional[NotebookHandler] = None
        self.executor = CellExecutor()
        
        # Create Flask app
        self.app = Flask(__name__, 
                        template_folder=os.path.join(os.path.dirname(__file__), 'templates'),
                        static_folder=os.path.join(os.path.dirname(__file__), 'static'))
        self.app.config['SECRET_KEY'] = 'morecompute-secret-key'
        
        # Initialize SocketIO
        self.socketio = SocketIO(self.app, cors_allowed_origins="*")
        
        # Setup routes
        self._setup_routes()
        self._setup_socket_handlers()
    
    def _setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/')
        def index():
            return render_template('notebook.html')
        
        @self.app.route('/api/notebook')
        def get_notebook():
            """Get current notebook data"""
            if self.notebook_handler:
                return jsonify(self.notebook_handler.to_dict())
            else:
                # Return empty notebook
                empty_notebook = NotebookHandler()
                return jsonify(empty_notebook.to_dict())
        
        @self.app.route('/api/save', methods=['POST'])
        def save_notebook():
            """Save current notebook"""
            try:
                data = request.json
                file_path = data.get('file_path')
                
                if not file_path:
                    # Generate a default filename
                    file_path = 'untitled.py'
                
                if self.notebook_handler:
                    self.notebook_handler.save_file(file_path)
                    return jsonify({'status': 'success', 'file_path': file_path})
                else:
                    return jsonify({'status': 'error', 'message': 'No notebook loaded'})
                    
            except Exception as e:
                return jsonify({'status': 'error', 'message': str(e)})
        
        @self.app.route('/api/variables')
        def get_variables():
            """Get current kernel variables"""
            return jsonify(self.executor.get_variables())
        
        @self.app.route('/assets/<path:filename>')
        def serve_assets(filename):
            """Serve assets from the assets directory"""
            import os
            from flask import send_from_directory
            assets_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'assets')
            return send_from_directory(assets_dir, filename)
    
    def _setup_socket_handlers(self):
        """Setup SocketIO event handlers"""
        
        @self.socketio.on('connect')
        def handle_connect():
            if self.debug:
                print('Client connected')
            # Send current notebook data
            if self.notebook_handler:
                emit('notebook_data', self.notebook_handler.to_dict())
            else:
                # Send empty notebook data to initialize the frontend
                empty_notebook = NotebookHandler()
                emit('notebook_data', empty_notebook.to_dict())
        
        @self.socketio.on('disconnect')
        def handle_disconnect():
            if self.debug:
                print('Client disconnected')
        
        @self.socketio.on('execute_cell')
        def handle_execute_cell(data):
            """Execute a cell and return results"""
            try:
                cell_index = data.get('cell_index')
                source_code = data.get('source')
                
                if source_code is None:
                    emit('execution_error', {'error': 'No source code provided'})
                    return
                
                # Execute the cell
                result = self.executor.execute_cell(source_code)
                
                # Update cell in notebook if we have one
                if self.notebook_handler and cell_index is not None:
                    if 0 <= cell_index < len(self.notebook_handler.cells):
                        cell = self.notebook_handler.cells[cell_index]
                        cell.outputs = result['outputs']
                        cell.execution_count = result['execution_count']
                
                # Send result back
                emit('execution_result', {
                    'cell_index': cell_index,
                    'result': result
                })
                
            except Exception as e:
                emit('execution_error', {'error': str(e)})
        
        @self.socketio.on('update_cell')
        def handle_update_cell(data):
            """Update cell source code"""
            try:
                cell_index = data.get('cell_index')
                source = data.get('source', '')
                
                if self.notebook_handler and cell_index is not None:
                    self.notebook_handler.update_cell(cell_index, source)
                    
                emit('cell_updated', {
                    'cell_index': cell_index,
                    'source': source
                })
                
            except Exception as e:
                emit('update_error', {'error': str(e)})
        
        @self.socketio.on('add_cell')
        def handle_add_cell(data):
            """Add a new cell"""
            try:
                index = data.get('index', -1)
                cell_type = data.get('cell_type', 'code')
                source = data.get('source', '')
                
                if self.notebook_handler:
                    new_index = self.notebook_handler.add_cell(index, cell_type, source)
                else:
                    # Create new notebook if none exists
                    self.notebook_handler = NotebookHandler()
                    new_index = self.notebook_handler.add_cell(index, cell_type, source)
                
                # Broadcast updated notebook
                emit('notebook_updated', self.notebook_handler.to_dict(), broadcast=True)
                
            except Exception as e:
                emit('add_cell_error', {'error': str(e)})
        
        @self.socketio.on('delete_cell')
        def handle_delete_cell(data):
            """Delete a cell"""
            try:
                cell_index = data.get('cell_index')
                
                if self.notebook_handler and cell_index is not None:
                    success = self.notebook_handler.delete_cell(cell_index)
                    if success:
                        # Broadcast updated notebook
                        emit('notebook_updated', self.notebook_handler.to_dict(), broadcast=True)
                    else:
                        emit('delete_error', {'error': 'Cell index out of range'})
                        
            except Exception as e:
                emit('delete_error', {'error': str(e)})
        
        @self.socketio.on('reset_kernel')
        def handle_reset_kernel():
            """Reset the execution kernel"""
            try:
                self.executor.reset_kernel()
                
                # Clear all cell outputs
                if self.notebook_handler:
                    for cell in self.notebook_handler.cells:
                        cell.outputs = []
                        cell.execution_count = None
                
                emit('kernel_reset', broadcast=True)
                
            except Exception as e:
                emit('reset_error', {'error': str(e)})
        
        @self.socketio.on('save_notebook')
        def handle_save_notebook(data):
            """Save the current notebook"""
            try:
                file_path = data.get('file_path', 'untitled.py')
                
                if self.notebook_handler:
                    self.notebook_handler.save_file(file_path)
                    emit('save_success', {'file_path': file_path})
                else:
                    emit('save_error', {'error': 'No notebook loaded'})
                    
            except Exception as e:
                emit('save_error', {'error': str(e)})
    
    def set_notebook_file(self, file_path: str):
        """Set the current notebook file"""
        try:
            self.notebook_handler = NotebookHandler(file_path)
        except Exception as e:
            print(f"Error loading notebook file: {e}")
            # Create empty notebook as fallback
            self.notebook_handler = NotebookHandler()
    
    def run(self, debug=False):
        """Run the Flask server"""
        if debug:
            print(f"Starting MoreCompute server on {self.host}:{self.port}")
        
        # Configure logging based on debug mode
        import logging
        if not debug:
            # Suppress Flask and Werkzeug logs
            logging.getLogger('werkzeug').setLevel(logging.ERROR)
            self.app.logger.disabled = True
        
        self.socketio.run(self.app, host=self.host, port=self.port, debug=debug)
    
    def shutdown(self):
        """Shutdown the server"""
        # This is a placeholder - Flask dev server doesn't have a clean shutdown method
        print("Server shutdown requested...")
