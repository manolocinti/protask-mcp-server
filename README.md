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

### Server remoto (HTTP) con Claude Code

```bash
printf 'ProTask token: '; read -s PROTASK_TOKEN; echo; claude mcp add --transport http --scope user protask https://protask-mcp.ilmarketing.net/mcp/sse --header "Authorization: Bearer $PROTASK_TOKEN"; unset PROTASK_TOKEN
```

Il comando è su una sola riga. Incolla il tuo token personale ProTask quando te lo chiede e premi Invio: non viene mostrato e non finisce nella history. Non condividerlo e non committarlo. `--scope user` lo registra per il tuo utente, non nel `.mcp.json` del progetto.

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
- `protask_my_tasks` - I miei task (compatti; esclusi quelli segnati come fatti, `include_done: true` per averli. Ci sono anche i task nelle colonne "Fatto" o "Concluso": la colonna sta in `list.title`)
- `protask_find_colleague` - Trasforma un nome in `user_id` cercando tra le persone di un progetto (`project_id`, `name`)
- `protask_list_tasks` - Lista task
- `protask_get_task` - Dettaglio task
- `protask_create_task` - Crea task
- `protask_update_task` - Aggiorna task
- `protask_delete_task` - Elimina task
- `protask_move_task` - Sposta task: colonna con `list_id` oppure `list_name`; opzionali `message` (riassunto salvato come commento), `notify_user_ids` (max 20, solo persone indicate dall'utente) e `order`
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
- `protask_create_comment` - Aggiungi commento (avvisa tutti i membri del workspace; per avvisare solo alcune persone usa `protask_move_task` con `message` e `notify_user_ids`)

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

## Aggiornamento automatico sul server

Sul VPS il server gira con pm2 (`protask-mcp`) da un clone di `main`. `scripts/auto-update.sh` lo
aggiorna da solo quando `main` cambia: fa `git fetch`, poi `npm ci` solo se cambiano le dipendenze,
poi `npm test` (che fa anche la build), `pm2 restart` e il controllo di `http://127.0.0.1:3456/health`.
Se test o health falliscono torna al commit di prima e salta quello nuovo finché `main` non cambia
ancora. Con modifiche locali non committate non tocca niente.

Si installa una volta sola, nel crontab dell'utente che fa girare pm2 (`crontab -e`):

```
*/5 * * * * $HOME/protask-mcp-server/scripts/auto-update.sh >> $HOME/protask-mcp-update.log 2>&1
```

Il log si legge con `tail $HOME/protask-mcp-update.log`. Variabili per cambiare i valori di default:
`PROTASK_MCP_DIR`, `PROTASK_MCP_BRANCH`, `PROTASK_MCP_PM2_APP`, `PROTASK_MCP_HEALTH_URL`.
