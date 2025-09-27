from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="morecompute",
    version="0.1.0",
    author="Your Name",
    author_email="your.email@example.com",
    description="An interactive notebook environment like Marimo and Google Colab",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/yourusername/morecompute",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.8",
    install_requires=[
        "fastapi>=0.104.0",
        "uvicorn[standard]>=0.24.0",
        "jinja2>=3.0.0",
        "python-multipart>=0.0.5",
        "jupyter>=1.0.0",
        "nbformat>=5.0.0",
        "click>=8.0.0",
    ],
    entry_points={
        "console_scripts": [
            "kernel_run=kernel_run:main",
        ],
    },
    include_package_data=True,
    package_data={
        # Ensure wheel includes nested static/js/css/html assets
        "morecompute": [
            "static/*",
            "static/**/*",
            "templates/*",
            "templates/**/*",
        ],
    },
)
