# Guía Operativa de Infraestructura Docker Local — BuildMeAPP

Este documento describe la arquitectura, configuración, ejecución y mantenimiento de la infraestructura Docker local para **BuildMeAPP**.

---

## 1. Arquitectura de la Infraestructura

La infraestructura local de BuildMeAPP está compuesta por tres servicios desacoplados, una red interna aislada y dos volúmenes persistentes nombrados:

```
                          ┌───────────────────────────┐
                          │   Navegador / Cliente     │
                          │   http://127.0.0.1:3000   │
                          └─────────────┬─────────────┘
                                        │
┌─ RED DOCKER AISLADA (buildmeapp_network) ──────────────────────────────────┐
│                                       │                                   │
│  ┌────────────────────────────────────▼────────────────────────────────┐  │
│  │ Servicio 'app' (Contenedor: buildmeapp_app)                         │  │
│  │ - Runtime: Node.js 24 (Bookworm Slim) en modo standalone Next.js 15 │  │
│  │ - Usuario de ejecución: no-root (node, UID 1000)                    │  │
│  │ - Puerto publicado en host: 127.0.0.1:3000                          │  │
│  │ - Conexión DB interna: buildmeapp_test_user hacia db:5432           │  │
│  └──────────────────┬─────────────────────────────▲────────────────────┘  │
│                     │                             │                       │
│                     │                             │                       │
│  ┌──────────────────▼──────────────────┐   ┌──────┴────────────────────┐  │
│  │ Volumen 'buildmeapp_app_storage'    │   │ Servicio 'migrator'       │  │
│  │ - Montado en: /app/storage          │   │ (Perfil: migration)       │  │
│  │ - Preserva subidas y multimedia     │   │ - Prisma CLI 7.10.0       │  │
│  └─────────────────────────────────────┘   │ - Ejecución manual        │  │
│                                            └──────┬────────────────────┘  │
│                                                   │                       │
│  ┌────────────────────────────────────────────────▼────────────────────┐  │
│  │ Servicio 'db' (Contenedor: buildmeapp_postgres)                     │  │
│  │ - Motor: PostgreSQL 18.6 (Bookworm)                                 │  │
│  │ - Base administrativa: postgres                                     │  │
│  │ - Bases de prueba: buildmeapp_orders_test / shadow_test             │  │
│  │ - Puerto publicado en host: 127.0.0.1:5433 (no estándar)            │  │
│  └──────────────────┬──────────────────────────────────────────────────┘  │
│                     │                                                     │
│  ┌──────────────────▼──────────────────┐                                  │
│  │ Volumen 'buildmeapp_postgres_data'  │                                  │
│  │ - Montado en: /var/lib/postgresql   │                                  │
│  │ - Preserva tablas e índices locales │                                  │
│  └─────────────────────────────────────┘                                  │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Requisitos de Entorno y Compatibilidad

Esta infraestructura ha sido diseñada y validada para los siguientes componentes:

- **Sistema Operativo Host:** Windows 11 (versión 23H2 o superior).
- **Capa Linux:** Ubuntu 24.04 LTS sobre WSL2 (Windows Subsystem for Linux).
- **Docker Engine:** Versión 29.9.2 o superior.
- **Docker Compose:** Versión 5.6.1 o superior.
- **Node.js en Host/Windows:** Node.js 24.14.0 (no se requiere Node.js instalado nativamente en WSL2, ya que la aplicación y sus dependencias se compilan dentro de contenedores).
- **Seguridad de Puertos:** Todos los puertos publicados (`3000` y `5433`) están enlazados estrictamente a la interfaz de bucle invertido (`127.0.0.1`), impidiendo accesos desde redes externas o de área local.

---

## 3. Configuración de Variables de Entorno (`.env.docker`)

El proyecto dispone de la plantilla `docker.env.example`, la cual contiene la relación completa de variables requeridas sin credenciales reales.

### Ubicación Segura Fuera de OneDrive:
Dado que el repositorio puede estar ubicado en una ruta sincronizada por Microsoft OneDrive (`OneDrive/Documents/BuildMeApp`), **no se recomienda** almacenar el archivo `.env.docker` dentro del árbol de trabajo, ya que el servicio OneDrive intentará sincronizar las credenciales a la nube (a pesar de estar ignoradas por `.gitignore`).

La ubicación recomendada y estándar es el directorio privado de usuario en Linux:

```bash
mkdir -p "$HOME/.config/buildmeapp"
cp docker.env.example "$HOME/.config/buildmeapp/.env.docker"
chmod 600 "$HOME/.config/buildmeapp/.env.docker"
```

> [!IMPORTANT]
> - El archivo `.env.docker` en `$HOME/.config/buildmeapp/` tiene permisos estrictos `600` (solo lectura y escritura para su usuario).
> - Nunca guarde credenciales reales dentro del directorio de OneDrive.
> - Si temporalmente crea un `.env.docker` en la raíz del proyecto, está protegido por la regla `.env*` en `.gitignore`, pero elimínelo o muévalo inmediatamente fuera de OneDrive.
> - Todos los comandos de Docker Compose deben ejecutarse con la bandera `--env-file ~/.config/buildmeapp/.env.docker` (o definiendo una variable de conveniencia: `export DOCKER_ENV="$HOME/.config/buildmeapp/.env.docker"`).

---

## 4. Generación Segura de Credenciales

Abra el archivo `.env.docker` recién creado. Deberá generar tres secretos criptográficos independientes de alta entropía (32 bytes en formato hexadecimal).

Ejecute en su terminal:

```bash
# Para la contraseña administrativa de PostgreSQL:
openssl rand -hex 32

# Para la contraseña del rol de aplicación de PostgreSQL:
openssl rand -hex 32

# Para el secreto de firma de sesiones (Auth.js / NextAuth):
openssl rand -hex 32
```

Copie cada uno de los valores resultantes en las variables correspondientes de `.env.docker`:

```env
POSTGRES_PASSWORD=<resultado_hex_admin>
APP_DB_PASSWORD=<resultado_hex_app>
AUTH_SECRET=<resultado_hex_auth>
```

> [!NOTE]
> Al generarse en formato hexadecimal puro (`[0-9a-f]`), estas contraseñas no requieren codificación de URL en `compose.yaml`. Las cadenas `DATABASE_URL` y `SHADOW_DATABASE_URL` son construidas automáticamente por Docker Compose; **no es necesario escribirlas manualmente**.

---

## 5. Función de Roles: Administrador vs. Usuario de Aplicación

Para cumplir con el principio de privilegios mínimos, la infraestructura separa estrictamente las funciones de base de datos:

| Atributo | Administrador (`buildmeapp_test_admin`) | Usuario de Aplicación (`buildmeapp_test_user`) |
| :--- | :--- | :--- |
| **Rol en PostgreSQL** | Propietario de la instancia y del proceso `initdb` | Rol con privilegios mínimos asignados |
| **Privilegios** | Superusuario administrativo (`SUPERUSER`) | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` |
| **Bases accesibles** | Todas (`postgres`, plantillas, pruebas) | Exclusivamente `buildmeapp_orders_test` y `buildmeapp_orders_shadow_test` |
| **Uso en Compose** | Exclusivamente por el servicio `db` para inicialización | Utilizado por `app` y `migrator` en `DATABASE_URL` |
| **Propiedad de Esquema** | Crea las bases y transfiere propiedad | Propietario del esquema `public` de sus bases de prueba |

---

## 6. Inicialización de PostgreSQL (`01-create-test-databases.sh`)

El archivo `docker/init/01-create-test-databases.sh` es montado en `/docker-entrypoint-initdb.d/` en modo de solo lectura (`:ro`).

### Comportamiento Oficial de Docker PostgreSQL:
1. El script se ejecuta **únicamente la primera vez** que se levanta un volumen nuevo y vacío (`/var/lib/postgresql`).
2. Se conecta a la base administrativa `postgres`.
3. Valida los identificadores para prevenir inyección SQL (máximo 63 bytes, caracteres alfanuméricos ASCII y guion bajo, rechazo de bases del sistema y rechazo estricto de `mydb`).
4. Lee `APP_DB_PASSWORD` mediante el comando seguro `\getenv` de `psql` (sin exponerla en argumentos de shell ni en logs).
5. Crea el rol `buildmeapp_test_user` y las bases de datos `buildmeapp_orders_test` y `buildmeapp_orders_shadow_test`.
6. Conecta a cada base de prueba y asigna la propiedad de `public` y permisos completos de tablas y secuencias al usuario de aplicación.
7. **Persistencia:** En arranques posteriores con el mismo volumen, el motor detecta la base de datos ya inicializada y **omite el script**, conservando íntegros los datos previos.

---

## 7. Comprobación de las Bases de Datos Creadas

Una vez iniciado el servicio `db`, puede verificar la existencia de las bases de datos y la asignación de roles ejecutando:

```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker exec db psql -U buildmeapp_test_admin -d postgres -c "\l"
```

Deberá observar en la salida:
- `buildmeapp_orders_test` con propietario `buildmeapp_test_user`.
- `buildmeapp_orders_shadow_test` con propietario `buildmeapp_test_user`.
- `postgres` con propietario `buildmeapp_test_admin`.

---

## 8. Inicio del Servicio de Base de Datos (`db`)

Para iniciar únicamente la base de datos de pruebas locales en segundo plano:

```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker up -d db
```

Para verificar que la base de datos ha superado el healthcheck (`healthy`):

```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker ps db
```

---

## 9. Ejecución Manual de Migraciones Prisma

Las migraciones de esquema nunca se ejecutan de forma automática al arrancar la aplicación. Para ejecutar operaciones de esquema, se utiliza el servicio dedicado `migrator` bajo el perfil `migration`.

### Comandos y Diferencias de Uso:

#### A. Consultar el estado de las migraciones (Lectura segura):
Muestra qué migraciones están aplicadas y cuáles están pendientes sin modificar la base de datos:
```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker run --rm migrator
```

#### B. Aplicar migraciones existentes en el entorno local (Procedimiento habitual):
Aplica las migraciones pendientes del repositorio sobre la base `buildmeapp_orders_test`:
```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker run --rm migrator npx prisma migrate deploy
```

#### C. Crear una nueva migración en modo interactivo de desarrollo (Solo para desarrolladores):
Compara el esquema `prisma/schema.prisma` con la base shadow `buildmeapp_orders_shadow_test` y genera un nuevo archivo SQL:
```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker run --rm migrator npx prisma migrate dev
```

> [!WARNING]
> No ejecute `prisma migrate dev` en entornos con datos que no puedan restablecerse. Utilice siempre `prisma migrate deploy` para aplicar cambios de esquema ya versionados.

---

## 10. Construcción de la Imagen de la Aplicación (`app`)

Para compilar la aplicación Next.js en modo standalone dentro del contenedor:

```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker build app
```

> [!NOTE]
> Durante la etapa `builder`, las variables públicas con prefijo `NEXT_PUBLIC_*` son incorporadas al paquete de cliente compilado por Next.js. Si actualiza una variable pública en `.env.docker`, deberá ejecutar nuevamente el comando de construcción (`build app`) para que surta efecto.

---

## 11. Inicio y Apagado de los Servicios

### Iniciar la infraestructura completa (base de datos y aplicación):
```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker up -d
```
La aplicación estará accesible en: `http://127.0.0.1:3000`.

### Ver los registros en tiempo real:
```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker logs -f app
```

### Detener los contenedores sin eliminarlos:
```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker stop
```

### Detener y remover los contenedores (preservando los datos):
```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker down
```

---

## 12. Actualización de la Aplicación sin Pérdida de Datos

Cuando modifique el código fuente de Next.js, actualice la aplicación de forma transparente sin alterar los datos de la base de datos ni los archivos subidos:

```bash
# 1. Reconstruir la imagen de la aplicación con los nuevos cambios
docker compose --env-file ~/.config/buildmeapp/.env.docker build app

# 2. Reiniciar el contenedor de la aplicación con la nueva imagen
docker compose --env-file ~/.config/buildmeapp/.env.docker up -d --no-deps app
```

---

## 13. Persistencia de Datos de PostgreSQL

Los datos de PostgreSQL se almacenan en el volumen Docker con nombre:
- **Nombre:** `buildmeapp_postgres_data`
- **Punto de montaje en contenedor:** `/var/lib/postgresql`

Este volumen es administrado por el subsistema Docker de WSL2 y es completamente independiente de los contenedores. Reiniciar o recrear el contenedor `db` no destruye las tablas ni los registros.

---

## 14. Persistencia de Archivos y Multimedia (`storage`)

Los archivos multimedia, reportes y diagnósticos subidos se almacenan en:
- **Nombre:** `buildmeapp_app_storage`
- **Punto de montaje en contenedor:** `/app/storage`

El directorio está configurado con permisos de usuario `node:node` (UID 1000). Reconstruir la imagen de la aplicación no altera los archivos almacenados en este volumen.

---

## 15. Copia de Seguridad de la Base de Datos (`pg_dump`)

Para generar un respaldo de la base de datos local en un archivo SQL en la máquina anfitriona:

```bash
docker compose --env-file ~/.config/buildmeapp/.env.docker exec -T db pg_dump \
  -U buildmeapp_test_admin \
  -d buildmeapp_orders_test \
  --clean --if-exists > backup_buildmeapp_orders_test_$(date +%Y%m%d_%H%M%S).sql
```

El archivo `.sql` resultante quedará guardado en su directorio de trabajo actual en WSL.

---

## 16. Restauración de una Copia de Seguridad

> [!CAUTION]
> La restauración de una copia de seguridad sobreescribirá las tablas existentes en la base de destino. Asegúrese de realizar una copia previa o restaurar en una base aislada para verificación.

Para restaurar un archivo de respaldo sobre la base principal:

```bash
cat <nombre_archivo_backup>.sql | docker compose --env-file ~/.config/buildmeapp/.env.docker exec -T db psql \
  -U buildmeapp_test_admin \
  -d buildmeapp_orders_test
```

---

## 17. Diferencia entre Eliminar Contenedores y Eliminar Volúmenes

Es fundamental comprender el ciclo de vida de Docker:

- `docker compose down`: Detiene y elimina los contenedores y las redes virtuales. **Los volúmenes nombrados permanecen intactos**. La base de datos y los archivos en storage se conservan exactamente como estaban.
- `docker compose down -v`: Detiene los contenedores y **elimina permanentemente los volúmenes nombrados**.

---

## 18. Advertencia Crítica sobre `docker compose down -v`

> [!CAUTION]
> **NUNCA ejecute `docker compose down -v` en su flujo diario de trabajo.**
>
> La bandera `-v` (o `--volumes`) destruye inmediatamente los volúmenes `buildmeapp_postgres_data` y `buildmeapp_app_storage`.
> Esta acción provoca:
> 1. Eliminación irreversible de todas las tablas, órdenes, usuarios y registros de prueba en PostgreSQL.
> 2. Eliminación de todos los archivos y adjuntos en `/app/storage`.
>
> Utilice `-v` única y exclusivamente cuando desee reiniciar desde cero la infraestructura de pruebas locales descartando intencionalmente todo el estado previo.
