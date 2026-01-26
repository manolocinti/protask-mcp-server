# ProTask MCP Server

Server MCP per integrare ProTask con Claude Code e altri client MCP.

## Installazione

```bash
cd ~/protask-mcp-server
npm install
npm run build
```

## Configurazione Claude Code

Aggiungi questa configurazione al file `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "protask": {
      "command": "node",
      "args": ["/Users/manolocinti/protask-mcp-server/dist/index.js"],
      "env": {
        "PROTASK_TOKEN": "IL_TUO_TOKEN_QUI",
        "PROTASK_API_URL": "https://protask.ilmarketing.net/api/v1"
      }
    }
  }
}
```

## Tools Disponibili

### Autenticazione
- `protask_get_me` - Info utente corrente

### Workspaces
- `protask_list_workspaces` - Lista workspace
- `protask_get_workspace` - Dettaglio workspace
- `protask_create_workspace` - Crea workspace
- `protask_get_workspace_members` - Membri workspace

### Projects
- `protask_list_projects` - Lista progetti
- `protask_get_project` - Dettaglio progetto
- `protask_create_project` - Crea progetto
- `protask_update_project` - Aggiorna progetto
- `protask_delete_project` - Elimina progetto

### Board Lists
- `protask_list_board_lists` - Lista colonne
- `protask_create_board_list` - Crea colonna
- `protask_update_board_list` - Aggiorna colonna
- `protask_delete_board_list` - Elimina colonna

### Labels
- `protask_list_labels` - Lista etichette
- `protask_create_label` - Crea etichetta

### Tasks
- `protask_list_tasks` - Lista task
- `protask_get_task` - Dettaglio task
- `protask_create_task` - Crea task
- `protask_update_task` - Aggiorna task
- `protask_delete_task` - Elimina task
- `protask_move_task` - Sposta task
- `protask_add_task_assignee` - Assegna utente
- `protask_remove_task_assignee` - Rimuovi assegnatario
- `protask_add_task_label` - Aggiungi etichetta
- `protask_remove_task_label` - Rimuovi etichetta

### Checklists
- `protask_list_checklists` - Lista checklist
- `protask_create_checklist` - Crea checklist
- `protask_add_checklist_item` - Aggiungi item
- `protask_update_checklist_item` - Aggiorna item (check/uncheck)

### Comments
- `protask_list_comments` - Lista commenti
- `protask_create_comment` - Aggiungi commento

### Timers
- `protask_get_active_timer` - Timer attivo
- `protask_get_my_timers` - I miei timer
- `protask_start_timer` - Avvia timer
- `protask_stop_timer` - Ferma timer
- `protask_add_manual_time` - Aggiungi tempo manuale

## Variabili d'ambiente

- `PROTASK_TOKEN` (obbligatorio) - Token API ProTask
- `PROTASK_API_URL` (opzionale) - URL base API (default: https://protask.ilmarketing.net/api/v1)

## Ottenere un Token

1. Fai login all'API:
```bash
curl -X POST https://protask.ilmarketing.net/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"tua@email.com","password":"password"}'
```

2. Copia il token dalla risposta e usalo nella configurazione.
