#!/bin/bash
set -e

VENV_DIR=".venv"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Use the python interpreter from the virtual environment
PY="./$VENV_DIR/bin/python"

# Install/Upgrade pip using the venv python
echo "Upgrading pip..."
$PY -m pip install --upgrade pip

# Install requirements
if [ -f requirements.txt ]; then
    echo "Installing requirements..."
    $PY -m pip install -r requirements.txt
fi

# Run the application
export PORT=${PORT:-5000}
echo "Starting app on port $PORT..."
$PY app.py
