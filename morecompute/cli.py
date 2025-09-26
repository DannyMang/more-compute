import click
from pathlib import Path
from .notebook import Notebook

@click.group()
def main():
    """MoreCompute CLI."""


@main.command()
@click.argument('notebook_path', required=True)
def new(notebook_path: str):
    """Create a new .ipynb notebook."""
    path = Path(notebook_path).expanduser().resolve()

    if path.suffix != '.ipynb':
        raise click.UsageError("Only .ipynb notebooks are supported right now.")

    if path.exists():
        raise click.ClickException(f"File '{path}' already exists")

    path.parent.mkdir(parents=True, exist_ok=True)

    notebook = Notebook(str(path))
    notebook.save_to_file(str(path))

    click.echo(f"✅ Created notebook at {path}")


if __name__ == '__main__':
    main()
