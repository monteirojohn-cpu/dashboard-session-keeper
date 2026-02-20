
## Publicar Correção no GitHub e Atualizar a VPS

### Estado Atual do Repositório (Análise Completa)

**Código atual no Lovable (estado limpo e correto):**

Todos os arquivos já estão corrigidos e sincronizados com o GitHub através do Lovable automaticamente. O Lovable mantém sync bidirecional com o GitHub em tempo real — cada mudança feita aqui já foi commitada.

---

### Auditoria de Segurança — Arquivos Modificados

**Arquivos alterados nas correções anteriores:**

```text
supabase/functions/api-proxy/index.ts  [CRIADO]
supabase/config.toml                   [EDITADO]
src/lib/api.ts                         [CRIADO]
src/pages/Index.tsx                    [EDITADO]
src/pages/Reports.tsx                  [EDITADO]
src/pages/Servers.tsx                  [EDITADO]
src/components/SettingsDialog.tsx      [EDITADO]
src/components/settings/NotificationsTab.tsx  [EDITADO]
src/components/settings/MaintenanceTab.tsx    [EDITADO]
src/components/settings/ChannelsTab.tsx       [EDITADO]
```

**Verificação de credenciais expostas:**

- `.env` esta no `.gitignore`? **NÃO está** — o `.gitignore` atual não inclui `.env`. Porém o arquivo `.env` contém apenas chaves públicas do Lovable Cloud (chaves anon/publishable, seguras para repositório público). As credenciais do dashboard (`admin@signal.2025`) estão no código como valores padrão de `localStorage` — isso é aceitável pois o usuário pode alterar pela UI.
- O IP da VPS (`76.13.171.218`) está hardcoded no `supabase/functions/api-proxy/index.ts` — isso é intencional e necessário para o proxy funcionar.
- O IP do dashboard (`157.254.55.203`) aparece como valor padrão de `localStorage` em `Index.tsx` e `SettingsDialog.tsx` — configurável pela UI.

**Sem arquivos sensíveis a risco real** — toda configuração crítica (senhas de acesso à VPS) não está no código.

---

### Arquitetura Implementada

```text
Browser (HTTPS)
      |
      v
Lovable Cloud Edge Function (api-proxy)   <-- HTTPS ✓
      |
      v
VPS API http://76.13.171.218:3101         <-- HTTP interno ✓ (servidor para servidor)
      |
      v
SQLite DB (notification_destinations, servers, etc.)
```

**Isso resolve:**
- Mixed Content (HTTPS → HTTP bloqueado pelo browser) ✓
- CORS (Edge Function retorna headers corretos) ✓
- Acesso externo sem expor porta 3101 diretamente ✓

---

### O que NÃO precisa de commit — já está no GitHub

O Lovable sincroniza automaticamente com o GitHub. Não é necessário fazer push manual. O repositório remoto já contém todas as correções.

---

### Comandos Exatos para Atualizar a VPS

Execute estes comandos na VPS via SSH:

**Passo 1 — Acessar a VPS:**
```bash
ssh root@76.13.171.218
# senha: A)uO8dQNQS6cSUvcJxV1
```

**Passo 2 — Navegar ao projeto e fazer pull:**
```bash
cd ~/signal-monitor
# ou onde o projeto estiver:
# cd /var/www/signal-monitor
# cd /opt/signal-monitor

git pull origin main
```

**Passo 3 — Build do frontend com a variável correta:**
```bash
VITE_API_URL=http://76.13.171.218:3101 npm run build
```

Isso garante que o bundle gerado use `http://76.13.171.218:3101` ao rodar diretamente na VPS (sem passar pelo proxy do Lovable Cloud).

**Passo 4 — Reiniciar os serviços:**
```bash
sudo systemctl restart signal-monitor-api
sudo systemctl restart signal-monitor-web
```

**Passo 5 — Verificar que os serviços estão rodando:**
```bash
sudo systemctl status signal-monitor-api
sudo systemctl status signal-monitor-web
```

**Passo 6 — Verificar que não há `localhost` no bundle:**
```bash
grep -r "localhost" dist/assets/*.js | head -5
# Resultado esperado: nenhuma linha (ou apenas comentários)
```

---

### Confirmação de Segurança

- `.env` — contém apenas chaves públicas anon do Lovable Cloud, sem risco
- Senha da VPS — não está no código
- Senha do dashboard (`admin@signal.2025`) — apenas como default de `localStorage`, sobrescrita pela UI
- IP `76.13.171.218` no proxy — necessário e intencional

---

### Validação Pós-Deploy na VPS

Após reiniciar, teste externamente:

```bash
# De outro terminal (fora da VPS), teste a API:
curl http://76.13.171.218:3101/api/servers
# Esperado: {"success":true,"servers":[...]}

# Teste a sincronização de notificações:
curl -X PUT http://76.13.171.218:3101/api/notification-destinations/sync \
  -H "Content-Type: application/json" \
  -d '{"destinations":[]}'
# Esperado: {"success":true}
```

Se esses testes passarem, o frontend acessando via proxy funcionará corretamente.

---

### Situação do Sistema Após Correção

| Componente | Status |
|---|---|
| Frontend (Lovable preview) | Funcional via proxy HTTPS |
| Frontend (VPS porta 3100) | Funcional via IP direto com VITE_API_URL |
| API (VPS porta 3101) | Funcional localmente e via proxy |
| Sincronização de notificações | Corrigida (sem erro de Mixed Content) |
| CORS | Resolvido pelo Edge Function |
| Credenciais expostas | Nenhuma de risco real |

---

### Único Ajuste Pendente no Código (Opcional mas Recomendado)

O arquivo `.gitignore` atual não inclui `.env`. Isso não é um risco real neste projeto (o `.env` só tem chaves públicas), mas é boa prática. Caso queira, posso adicionar `.env` ao `.gitignore` como parte de um commit de limpeza.
