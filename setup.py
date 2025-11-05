from setuptools import setup, find_packages
from pathlib import Path

# Read version from single source
version = {}
with open(Path(__file__).parent / "morecompute" / "__version__.py") as f:
    exec(f.read(), version)

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="more-compute",
    version=version["__version__"],
    author="MoreCompute Team",
    author_email="hello@morecompute.dev",
    description="An interactive notebook environment for local and GPU computing",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/DannyMang/MORECOMPUTE",
    packages=find_packages(include=["morecompute*", "frontend*"]),
    package_data={
        "frontend": ["**/*"],
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
    python_requires=">=3.10",
    install_requires=[
        "fastapi>=0.104.0",
        "uvicorn[standard]>=0.24.0",
        "python-multipart>=0.0.5",
        "nbformat>=5.0.0",
        "click>=8.0.0",
        "pyzmq>=25.0.0",
        "psutil>=5.9.0",
        "httpx>=0.24.0",
        "cachetools>=5.3.0",
        "matplotlib>=3.5.0",
    ],
    entry_points={
        "console_scripts": [
            "more-compute=kernel_run:main",
        ],
    },
    py_modules=["kernel_run"],
    include_package_data=True,
)
