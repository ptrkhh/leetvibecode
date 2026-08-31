from contextlib import asynccontextmanager

from fastapi import FastAPI

from worker import start_workers


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_workers()
    yield

app = FastAPI(lifespan=lifespan)


@app.get("/healthz")
def healthz():
    return {"ok": True}
