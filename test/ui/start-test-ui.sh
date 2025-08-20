#!/bin/bash
echo "🚀 Starting LLM Document Optimizer Test UI..."
echo ""
echo "This will start a local web server to host the test UI"
echo "and avoid CORS issues with file:// protocol."
echo ""

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

node serve.js