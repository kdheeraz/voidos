"""voidOS mind — the Python side of the OS.

For now this package contains the client that lets AI logic invoke kernel
capabilities (syscalls) over the Unix-domain socket gate. Later milestones
add planning, memory consolidation, and the agent loop on top of it.
"""

from .client import Void, VoidError

__all__ = ["Void", "VoidError"]
