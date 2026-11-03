#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# BuildMeAPP - PostgreSQL Initialization Script (Local Docker Environment)
# ==============================================================================
# Este script se ejecuta ÚNICAMENTE durante la primera inicialización de un
# volumen nuevo de PostgreSQL (/var/lib/postgresql) a través del entrypoint oficial.
# Comportamiento oficial de Docker PostgreSQL:
# - Solo se ejecuta si el directorio de datos (/var/lib/postgresql) está vacío.
# - NO vuelve a ejecutarse automáticamente en arranques posteriores ni sobre
#   volúmenes que ya contengan una base de datos inicializada.
# ==============================================================================

echo "[INIT-DB] =========================================================="
echo "[INIT-DB] Iniciando aprovisionamiento de bases de datos locales..."
echo "[INIT-DB] =========================================================="

# ------------------------------------------------------------------------------
# 1. Definición y Validación de Identificadores Fijos de la Infraestructura
# ------------------------------------------------------------------------------
ADMIN_USER="${POSTGRES_USER:-buildmeapp_test_admin}"
ADMIN_DB="${POSTGRES_DB:-postgres}"

APP_USER="${APP_DB_USER:-buildmeapp_test_user}"
MAIN_DB="${APP_DB_NAME:-buildmeapp_orders_test}"
SHADOW_DB="${APP_SHADOW_DB_NAME:-buildmeapp_orders_shadow_test}"

validate_identifier() {
  local id="$1"
  local label="$2"

  if [[ -z "$id" ]]; then
    echo "[INIT-DB ERROR] $label no puede estar vacío." >&2
    exit 1
  fi

  # Solo caracteres ASCII alfanuméricos y guion bajo
  if [[ ! "$id" =~ ^[a-zA-Z0-9_]+$ ]]; then
    echo "[INIT-DB ERROR] $label contiene caracteres no válidos: '$id'. Solo se permiten [a-zA-Z0-9_]." >&2
    exit 1
  fi

  # Longitud máxima en PostgreSQL: NAMEDATALEN - 1 = 63 bytes
  if [[ ${#id} -gt 63 ]]; then
    echo "[INIT-DB ERROR] $label excede el límite de 63 bytes de PostgreSQL (${#id} bytes): '$id'." >&2
    exit 1
  fi

  local lower_id
  lower_id=$(echo "$id" | tr '[:upper:]' '[:lower:]')

  # Prohibición de bases de datos del sistema
  if [[ "$lower_id" == "postgres" || "$lower_id" == "template0" || "$lower_id" == "template1" ]]; then
    echo "[INIT-DB ERROR] $label no puede llamarse como una base del sistema: '$id'." >&2
    exit 1
  fi

  # Prohibición estricta de nombres antiguos (mydb, mydb_shadow)
  if [[ "$lower_id" == *"mydb"* ]]; then
    echo "[INIT-DB ERROR] $label contiene referencias prohibidas a 'mydb': '$id'." >&2
    exit 1
  fi
}

# Validar identificadores
validate_identifier "$APP_USER" "Usuario de aplicación (APP_DB_USER)"
validate_identifier "$MAIN_DB" "Base de datos principal (APP_DB_NAME)"
validate_identifier "$SHADOW_DB" "Base de datos shadow (APP_SHADOW_DB_NAME)"

# Verificar que las bases principal y shadow no coincidan
if [[ "$MAIN_DB" == "$SHADOW_DB" ]]; then
  echo "[INIT-DB ERROR] La base de datos principal y shadow no pueden ser la misma: '$MAIN_DB'." >&2
  exit 1
fi

# Verificar base administrativa de conexión
if [[ "$ADMIN_DB" != "postgres" ]]; then
  echo "[INIT-DB ERROR] La base administrativa POSTGRES_DB debe ser 'postgres', valor recibido: '$ADMIN_DB'." >&2
  exit 1
fi

# Verificar presencia de contraseña de aplicación
if [[ -z "${APP_DB_PASSWORD:-}" ]]; then
  echo "[INIT-DB ERROR] APP_DB_PASSWORD no está definida en el entorno. No se puede aprovisionar el rol de aplicación." >&2
  exit 1
fi

echo "[INIT-DB] Parámetros validados exitosamente:"
echo "[INIT-DB]   - Base Administrativa de Inicialización: $ADMIN_DB"
echo "[INIT-DB]   - Usuario Administrativo: $ADMIN_USER"
echo "[INIT-DB]   - Rol de Aplicación: $APP_USER"
echo "[INIT-DB]   - Base de Datos Principal: $MAIN_DB"
echo "[INIT-DB]   - Base de Datos Shadow: $SHADOW_DB"

# ------------------------------------------------------------------------------
# 2. Creación del Rol de Aplicación y Bases en la Base Administrativa 'postgres'
# ------------------------------------------------------------------------------
# Conexión EXCLUSIVA a la base administrativa 'postgres'.
# La contraseña de aplicación se obtiene de forma segura mediante \getenv en psql,
# evitando interpolación directa en sentencias de shell o argumentos de procesos.
# Se utiliza format() con %I (identificadores) y %L (literales) junto con \gexec.
echo "[INIT-DB] Conectando a '$ADMIN_DB' para aprovisionar rol y bases..."

psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "$ADMIN_DB" \
  -v app_user="$APP_USER" \
  -v main_db="$MAIN_DB" \
  -v shadow_db="$SHADOW_DB" <<'EOSQL'
\getenv app_pwd APP_DB_PASSWORD

-- 2.1 Creación del rol si no existe, o actualización segura de contraseña
SELECT format(
  'CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;',
  :'app_user',
  :'app_pwd'
)
WHERE NOT EXISTS (
  SELECT FROM pg_catalog.pg_roles WHERE rolname = :'app_user'
)\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;',
  :'app_user',
  :'app_pwd'
)
WHERE EXISTS (
  SELECT FROM pg_catalog.pg_roles WHERE rolname = :'app_user'
)\gexec

-- 2.2 Creación de la base de datos principal con propietario asignado
SELECT format(
  'CREATE DATABASE %I OWNER %I;',
  :'main_db',
  :'app_user'
)
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = :'main_db'
)\gexec

SELECT format(
  'ALTER DATABASE %I OWNER TO %I;',
  :'main_db',
  :'app_user'
)
WHERE EXISTS (
  SELECT FROM pg_database WHERE datname = :'main_db'
)\gexec

-- 2.3 Creación de la base de datos shadow con propietario asignado
SELECT format(
  'CREATE DATABASE %I OWNER %I;',
  :'shadow_db',
  :'app_user'
)
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = :'shadow_db'
)\gexec

SELECT format(
  'ALTER DATABASE %I OWNER TO %I;',
  :'shadow_db',
  :'app_user'
)
WHERE EXISTS (
  SELECT FROM pg_database WHERE datname = :'shadow_db'
)\gexec
EOSQL

echo "[INIT-DB] Rol y bases creados exitosamente en '$ADMIN_DB'."

# ------------------------------------------------------------------------------
# 3. Configuración de Esquema y Privilegios en Cada Base Creada
# ------------------------------------------------------------------------------
# Ahora que las bases ya existen físicamente, nos conectamos a cada una para
# asignar permisos completos sobre el esquema public al rol de aplicación.
for TARGET_DB in "$MAIN_DB" "$SHADOW_DB"; do
  echo "[INIT-DB] Configurando esquema 'public' y privilegios en '$TARGET_DB'..."
  psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "$TARGET_DB" \
    -v app_user="$APP_USER" <<'EOSQL'
    SELECT format('ALTER SCHEMA public OWNER TO %I;', :'app_user')\gexec
    SELECT format('GRANT ALL ON SCHEMA public TO %I;', :'app_user')\gexec
    SELECT format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I;', :'app_user')\gexec
    SELECT format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I;', :'app_user')\gexec
    SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON TABLES TO %I;', :'app_user', :'app_user')\gexec
    SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON SEQUENCES TO %I;', :'app_user', :'app_user')\gexec
EOSQL
done

echo "[INIT-DB] =========================================================="
echo "[INIT-DB] Inicialización de PostgreSQL finalizada con éxito."
echo "[INIT-DB] Bases de datos listas: '$MAIN_DB' y '$SHADOW_DB'."
echo "[INIT-DB] Propietario: '$APP_USER' (privilegios mínimos garantizados)."
echo "[INIT-DB] =========================================================="
