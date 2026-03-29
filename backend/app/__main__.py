import os
import uvicorn

port = int(os.environ.get("MEDHA_PORT", "18900"))
uvicorn.run("app.main:app", host="127.0.0.1", port=port)
