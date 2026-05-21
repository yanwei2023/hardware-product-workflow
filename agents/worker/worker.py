from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


class AgentRunStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    OUTPUT_READY = "OUTPUT_READY"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


@dataclass
class AgentTask:
    run_id: str
    work_package_id: str
    agent_key: str
    instruction: str
    input_refs: List[str]


@dataclass
class AgentOutput:
    run_id: str
    status: AgentRunStatus
    summary: str
    draft_markdown: str
    findings: List[str]
    evidence_refs: List[str]
    error: Optional[str] = None


def execute_agent_task(task: AgentTask) -> AgentOutput:
    """Minimal placeholder for the controlled agent execution contract."""
    return AgentOutput(
        run_id=task.run_id,
        status=AgentRunStatus.OUTPUT_READY,
        summary=f"{task.agent_key} prepared a draft for work package {task.work_package_id}.",
        draft_markdown=(
            "# Agent Draft\n\n"
            "This draft is advisory and must be reviewed by the assigned human owner before it can become a formal artifact.\n"
        ),
        findings=[
            "Human approval is required before baseline submission.",
            "Gate readiness must be checked after review completion.",
        ],
        evidence_refs=task.input_refs,
    )


if __name__ == "__main__":
    sample = AgentTask(
        run_id="agent-run-sample",
        work_package_id="wp-evt-report",
        agent_key="test_agent",
        instruction="Prepare EVT exit report draft.",
        input_refs=["artifact:evt-test-results", "artifact:issue-log"],
    )
    print(execute_agent_task(sample))

