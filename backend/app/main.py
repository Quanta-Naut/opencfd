from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import physics, geometry, solver, projects, settings, runs

app = FastAPI(title="OpenCFD Backend API", version="1.0.0")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "OpenCFD Backend"}

# Routers in the order their routes were first declared, so matching order is unchanged.
app.include_router(physics.router)
app.include_router(geometry.router)
app.include_router(solver.router)
app.include_router(projects.router)
app.include_router(settings.router)
app.include_router(runs.router)
