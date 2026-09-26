# Tasks

> **Status: alpha.** Tasks work end to end but the data model and UI may still
> change between minor versions.

A task is something someone has to do in a repository space: a title, optional details, a status, an assignee, a due date, a priority, and the place it came from. Tasks live in the database (`tasks`, V029), not in Git, because status changes all the time and a commit per checkbox would bury the document history.

## Where tasks come from

| Source | How | Status on creation |
|---|---|---|
| By hand | New task on a space's Tasks page or on My tasks | Open |
| Inbox note | Make a task, on a note in the inbox | Open |
| Quick Note | Tasks ticked in the Quick Note dialog | Open |
| Assistant | "Make that a task" in Ask (`create_task`) | Open |
| MCP client | `create_task` | Open |
| Meeting bot | Unticked action items of the meeting note | Suggested |

The meeting bot writes action items as Markdown checkboxes (`- [ ] Task — Owner`). When its notes arrive, every unticked checkbox becomes a suggested task for the person who invited the bot. An owner is matched to a member of the space by exact name or email, or by a first name only one member has. Anything vaguer stays unassigned, with the name kept in the description.

## Statuses

- **Suggested:** a draft only its recipient sees, under "To confirm" on My tasks and on the meeting note in the inbox. Confirm makes it Open; Dismiss deletes it.
- **Open**, **In progress**, **Done.** Ticking a task off sets Done and offers Undo.

## Who may do what

- Anyone who can read the space sees its tasks. Suggestions are the exception: only their recipient sees them.
- Creating, editing and deleting takes edit access to the space.
- The assignee may always change the status of their own task, even without edit access.
- A task can only be assigned to someone who can read the space.

## Where tasks show up

- **My tasks** (`/tasks`): suggestions to confirm, then open tasks assigned to the user across spaces.
- **Dashboard:** the first five open tasks and the number of suggestions waiting.
- **A space's Tasks page:** filters for not done, open, in progress and done, and "only mine".
- **Inbox:** a meeting note or inbox note lists the tasks made from it.
- **Ask:** tasks the assistant created are linked under its answer.

## Notifications

Assigning a task to someone else:

- sends them an email, unless their email mode is None or no SMTP is configured,
- adds an "assigned to you" item to their notification bell (`TASK_ASSIGNED` in `/api/notifications/feed`).

Confirming a suggestion that has an assignee counts as assigning it.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/tasks/mine` | `assigned` and `toConfirm` |
| GET | `/api/spaces/{spaceId}/tasks?status=&assigneeId=` | A group lists its readable repositories |
| GET | `/api/spaces/{spaceId}/tasks/assignees` | Members who can be assigned |
| POST | `/api/spaces/{spaceId}/tasks` | Create |
| GET | `/api/tasks/{taskId}` | One task |
| PATCH | `/api/tasks/{taskId}` | Absent fields stay; `clearAssignee`, `clearDueDate` and `clearPriority` remove a value |
| DELETE | `/api/tasks/{taskId}` | Delete, or dismiss a suggestion |
| GET | `/api/tasks?sourceType=&sourceId=` | Tasks made from one note, meeting or conversation |

MCP clients and the assistant use the same endpoints through the tools `list_tasks`, `create_task` and `update_task`.
