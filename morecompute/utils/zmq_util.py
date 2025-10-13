"""Utilities for ZMQ socket management and reconnection."""

import zmq
import os


def reconnect_zmq_sockets(
    executor: any,
    cmd_addr: str | None = None,
    pub_addr: str | None = None
) -> None:
    """
    Reconnect ZMQ executor sockets to new addresses.

    Args:
        executor: Executor instance with ZMQ sockets
        cmd_addr: Command socket address (defaults to local)
        pub_addr: Publish socket address (defaults to local)
    """
    # Use provided addresses or fall back to defaults
    final_cmd_addr = cmd_addr or os.getenv('MC_ZMQ_CMD_ADDR', 'tcp://127.0.0.1:5555')
    final_pub_addr = pub_addr or os.getenv('MC_ZMQ_PUB_ADDR', 'tcp://127.0.0.1:5556')

    # Update executor addresses
    executor.cmd_addr = final_cmd_addr
    executor.pub_addr = final_pub_addr

    # Mark as remote if using non-default ports (tunneled addresses)
    # Default local ports are 5555/5556, tunneled ports are typically 15555/15556
    # # is there a better way to do this?
    if ':15555' in final_cmd_addr or ':15556' in final_pub_addr:
        executor.is_remote = True
    else:
        executor.is_remote = False

    # Reconnect command socket (REQ)
    executor.req.close(0)  # type: ignore[reportAttributeAccessIssue]
    executor.req = executor.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
    executor.req.connect(executor.cmd_addr)  # type: ignore[reportAttributeAccessIssue]

    # Reconnect publish socket (SUB)
    executor.sub.close(0)  # type: ignore[reportAttributeAccessIssue]
    executor.sub = executor.ctx.socket(zmq.SUB)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
    executor.sub.connect(executor.pub_addr)  # type: ignore[reportAttributeAccessIssue]
    executor.sub.setsockopt_string(zmq.SUBSCRIBE, '')  # type: ignore[reportAttributeAccessIssue]


def reset_to_local_zmq(executor: any) -> None:
    """
    Reset executor to local ZMQ addresses.

    Args:
        executor: Executor instance to reset
    """
    executor.is_remote = False
    reconnect_zmq_sockets(executor)
