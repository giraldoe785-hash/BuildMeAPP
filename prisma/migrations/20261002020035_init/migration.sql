-- CreateEnum
CREATE TYPE "rol_usuario" AS ENUM ('CLIENTE', 'REPARADOR', 'ADMINISTRADOR');

-- CreateEnum
CREATE TYPE "estado_cuenta" AS ENUM ('PENDIENTE_VERIFICACION', 'EN_REVISION', 'VERIFICADO', 'RECHAZADO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "estado_orden" AS ENUM ('BUSCANDO', 'EN_CAMINO', 'EN_SITIO', 'EN_TRABAJO', 'FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "modalidad_servicio" AS ENUM ('INMEDIATA', 'PROGRAMADA');

-- CreateEnum
CREATE TYPE "metodo_diagnostico" AS ENUM ('ANALISIS_IA', 'CASO_PREDEFINIDO');

-- CreateEnum
CREATE TYPE "estado_costo_adicional" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "metodo_pago" AS ENUM ('TARJETA', 'FIXI_WALLET');

-- CreateEnum
CREATE TYPE "estado_pago" AS ENUM ('PENDIENTE', 'PREAUTORIZADO', 'CAPTURADO', 'LIBERADO', 'REEMBOLSADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "tipo_movimiento_wallet" AS ENUM ('RECARGA', 'PAGO_SERVICIO', 'REEMBOLSO_GARANTIA', 'TRANSFERENCIA_PROPINA');

-- CreateEnum
CREATE TYPE "estado_garantia" AS ENUM ('VIGENTE', 'EN_RECLAMACION', 'VENCIDA', 'ANULADA');

-- CreateEnum
CREATE TYPE "cancelado_por" AS ENUM ('CLIENTE', 'REPARADOR', 'SISTEMA', 'SOPORTE');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "telefono" VARCHAR(30),
    "passwordHash" VARCHAR(255) NOT NULL,
    "rol" "rol_usuario" NOT NULL DEFAULT 'CLIENTE',
    "estado" "estado_cuenta" NOT NULL DEFAULT 'PENDIENTE_VERIFICACION',
    "codigoVerificacion" VARCHAR(10),
    "intentosFallidosLogin" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfiles_clientes" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "nombres" VARCHAR(100) NOT NULL,
    "apellidos" VARCHAR(100) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perfiles_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direcciones_clientes" (
    "id" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "alias" VARCHAR(50) NOT NULL,
    "direccionTexto" VARCHAR(255) NOT NULL,
    "latitud" DECIMAL(10,7),
    "longitud" DECIMAL(10,7),
    "notasAcceso" TEXT,
    "esPredeterminada" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direcciones_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfiles_reparadores" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tipoDocumento" VARCHAR(30) NOT NULL,
    "numeroDocumento" VARCHAR(50) NOT NULL,
    "nombres" VARCHAR(100) NOT NULL,
    "apellidos" VARCHAR(100) NOT NULL,
    "direccion" TEXT,
    "ciudadCobertura" VARCHAR(100) NOT NULL,
    "enLinea" BOOLEAN NOT NULL DEFAULT false,
    "latitudActual" DECIMAL(10,7),
    "longitudActual" DECIMAL(10,7),
    "fechaUltimaTelemetria" TIMESTAMP(3),
    "calificacionPromedio" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "totalTrabajosCompletados" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perfiles_reparadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_reparadores" (
    "id" UUID NOT NULL,
    "reparadorId" UUID NOT NULL,
    "tipoDocumento" VARCHAR(50) NOT NULL,
    "archivoUrl" TEXT NOT NULL,
    "estado" VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    "fechaExpiracion" TIMESTAMP(3),
    "observacionesAdmin" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_reparadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias_servicio" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "iconoUrl" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reparador_especialidades" (
    "reparadorId" UUID NOT NULL,
    "categoriaId" UUID NOT NULL,
    "acreditadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reparador_especialidades_pkey" PRIMARY KEY ("reparadorId","categoriaId")
);

-- CreateTable
CREATE TABLE "cupones" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "descuentoPorcentaje" DECIMAL(5,2),
    "descuentoMontoFijo" DECIMAL(10,2),
    "fechaVencimiento" TIMESTAMP(3),
    "limiteUsos" INTEGER,
    "usosActuales" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cupones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_servicio" (
    "id" UUID NOT NULL,
    "numeroOrden" VARCHAR(50) NOT NULL,
    "clienteId" UUID NOT NULL,
    "reparadorId" UUID,
    "categoriaId" UUID NOT NULL,
    "direccionServicio" VARCHAR(255) NOT NULL,
    "latitud" DECIMAL(10,7),
    "longitud" DECIMAL(10,7),
    "notasAcceso" TEXT,
    "modalidad" "modalidad_servicio" NOT NULL,
    "fechaProgramada" TIMESTAMP(3),
    "franjaHoraria" VARCHAR(50),
    "metodoDiagnostico" "metodo_diagnostico" NOT NULL,
    "diagnosticoCausaRaiz" TEXT,
    "solucionPropuesta" TEXT,
    "archivoMultimediaUrl" TEXT,
    "codigoOtp" VARCHAR(4),
    "otpValidado" BOOLEAN NOT NULL DEFAULT false,
    "intentosFallidosOtp" INTEGER NOT NULL DEFAULT 0,
    "otpBloqueadoHasta" TIMESTAMP(3),
    "fotoEstadoInicialUrl" TEXT,
    "fotoEntregaFinalUrl" TEXT,
    "codigoOtpCierre" VARCHAR(4),
    "otpCierreValidado" BOOLEAN NOT NULL DEFAULT false,
    "fechaLimiteConformidad" TIMESTAMP(3),
    "costoVisita" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "costoManoObraEstimado" DECIMAL(10,2) NOT NULL,
    "costoGarantiaFixicare" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "montoDescuento" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cuponId" UUID,
    "totalPreautorizado" DECIMAL(10,2) NOT NULL,
    "totalCobradoFinal" DECIMAL(10,2),
    "propina" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "metodoPago" "metodo_pago" NOT NULL,
    "estadoPago" "estado_pago" NOT NULL DEFAULT 'PENDIENTE',
    "pasarelaHoldId" VARCHAR(100),
    "pasarelaCaptureId" VARCHAR(100),
    "estado" "estado_orden" NOT NULL DEFAULT 'BUSCANDO',
    "canceladoPor" "cancelado_por",
    "motivoCancelacion" TEXT,
    "penalidadAplicada" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "compensacionTecnico" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "esIntervencionAdmin" BOOLEAN NOT NULL DEFAULT false,
    "adminIntervencionId" UUID,
    "justificacionDesbloqueo" TEXT,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaAsignacion" TIMESTAMP(3),
    "fechaInicioViaje" TIMESTAMP(3),
    "fechaArriboSitio" TIMESTAMP(3),
    "fechaInicioTrabajo" TIMESTAMP(3),
    "fechaFinalizacion" TIMESTAMP(3),
    "fechaCancelacion" TIMESTAMP(3),

    CONSTRAINT "ordenes_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "costos_adicionales" (
    "id" UUID NOT NULL,
    "ordenId" UUID NOT NULL,
    "descripcion" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "fotoEvidenciaUrl" TEXT NOT NULL,
    "estado" "estado_costo_adicional" NOT NULL DEFAULT 'PENDIENTE',
    "pasarelaHoldIncrementalId" VARCHAR(100),
    "fechaSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaRespuesta" TIMESTAMP(3),

    CONSTRAINT "costos_adicionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garantias_fixicare" (
    "id" UUID NOT NULL,
    "codigoPoliza" VARCHAR(50) NOT NULL,
    "ordenId" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "reparadorId" UUID NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,
    "estado" "estado_garantia" NOT NULL DEFAULT 'VIGENTE',
    "certificadoPdfUrl" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garantias_fixicare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calificaciones_servicio" (
    "id" UUID NOT NULL,
    "ordenId" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "reparadorId" UUID NOT NULL,
    "puntuacion" INTEGER NOT NULL,
    "comentario" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calificaciones_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes_chat" (
    "id" UUID NOT NULL,
    "ordenId" UUID NOT NULL,
    "emisorId" UUID NOT NULL,
    "contenido" VARCHAR(500) NOT NULL,
    "esRespuestaRapida" BOOLEAN NOT NULL DEFAULT false,
    "leido" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixi_wallets" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "saldoDisponible" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldoRetenido" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixi_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transacciones_wallet" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "ordenId" UUID,
    "tipo" "tipo_movimiento_wallet" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "referenciaExterna" VARCHAR(100),
    "descripcion" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transacciones_wallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_telefono_key" ON "usuarios"("telefono");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_clientes_usuarioId_key" ON "perfiles_clientes"("usuarioId");

-- CreateIndex
CREATE INDEX "direcciones_clientes_clienteId_idx" ON "direcciones_clientes"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_reparadores_usuarioId_key" ON "perfiles_reparadores"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_reparadores_numeroDocumento_key" ON "perfiles_reparadores"("numeroDocumento");

-- CreateIndex
CREATE INDEX "perfiles_reparadores_enLinea_ciudadCobertura_idx" ON "perfiles_reparadores"("enLinea", "ciudadCobertura");

-- CreateIndex
CREATE INDEX "documentos_reparadores_reparadorId_idx" ON "documentos_reparadores"("reparadorId");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_servicio_nombre_key" ON "categorias_servicio"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_servicio_slug_key" ON "categorias_servicio"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "cupones_codigo_key" ON "cupones"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_servicio_numeroOrden_key" ON "ordenes_servicio"("numeroOrden");

-- CreateIndex
CREATE INDEX "ordenes_servicio_clienteId_idx" ON "ordenes_servicio"("clienteId");

-- CreateIndex
CREATE INDEX "ordenes_servicio_reparadorId_idx" ON "ordenes_servicio"("reparadorId");

-- CreateIndex
CREATE INDEX "ordenes_servicio_categoriaId_idx" ON "ordenes_servicio"("categoriaId");

-- CreateIndex
CREATE INDEX "ordenes_servicio_estado_fechaProgramada_idx" ON "ordenes_servicio"("estado", "fechaProgramada");

-- CreateIndex
CREATE INDEX "costos_adicionales_ordenId_idx" ON "costos_adicionales"("ordenId");

-- CreateIndex
CREATE UNIQUE INDEX "garantias_fixicare_codigoPoliza_key" ON "garantias_fixicare"("codigoPoliza");

-- CreateIndex
CREATE UNIQUE INDEX "garantias_fixicare_ordenId_key" ON "garantias_fixicare"("ordenId");

-- CreateIndex
CREATE INDEX "garantias_fixicare_clienteId_idx" ON "garantias_fixicare"("clienteId");

-- CreateIndex
CREATE INDEX "garantias_fixicare_reparadorId_idx" ON "garantias_fixicare"("reparadorId");

-- CreateIndex
CREATE UNIQUE INDEX "calificaciones_servicio_ordenId_key" ON "calificaciones_servicio"("ordenId");

-- CreateIndex
CREATE INDEX "calificaciones_servicio_clienteId_idx" ON "calificaciones_servicio"("clienteId");

-- CreateIndex
CREATE INDEX "calificaciones_servicio_reparadorId_idx" ON "calificaciones_servicio"("reparadorId");

-- CreateIndex
CREATE INDEX "mensajes_chat_ordenId_idx" ON "mensajes_chat"("ordenId");

-- CreateIndex
CREATE INDEX "mensajes_chat_emisorId_idx" ON "mensajes_chat"("emisorId");

-- CreateIndex
CREATE UNIQUE INDEX "fixi_wallets_usuarioId_key" ON "fixi_wallets"("usuarioId");

-- CreateIndex
CREATE INDEX "transacciones_wallet_walletId_idx" ON "transacciones_wallet"("walletId");

-- CreateIndex
CREATE INDEX "transacciones_wallet_ordenId_idx" ON "transacciones_wallet"("ordenId");

-- AddForeignKey
ALTER TABLE "perfiles_clientes" ADD CONSTRAINT "perfiles_clientes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direcciones_clientes" ADD CONSTRAINT "direcciones_clientes_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfiles_reparadores" ADD CONSTRAINT "perfiles_reparadores_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_reparadores" ADD CONSTRAINT "documentos_reparadores_reparadorId_fkey" FOREIGN KEY ("reparadorId") REFERENCES "perfiles_reparadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reparador_especialidades" ADD CONSTRAINT "reparador_especialidades_reparadorId_fkey" FOREIGN KEY ("reparadorId") REFERENCES "perfiles_reparadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reparador_especialidades" ADD CONSTRAINT "reparador_especialidades_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_servicio" ADD CONSTRAINT "ordenes_servicio_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_servicio" ADD CONSTRAINT "ordenes_servicio_reparadorId_fkey" FOREIGN KEY ("reparadorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_servicio" ADD CONSTRAINT "ordenes_servicio_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_servicio" ADD CONSTRAINT "ordenes_servicio_cuponId_fkey" FOREIGN KEY ("cuponId") REFERENCES "cupones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_servicio" ADD CONSTRAINT "ordenes_servicio_adminIntervencionId_fkey" FOREIGN KEY ("adminIntervencionId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costos_adicionales" ADD CONSTRAINT "costos_adicionales_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garantias_fixicare" ADD CONSTRAINT "garantias_fixicare_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garantias_fixicare" ADD CONSTRAINT "garantias_fixicare_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garantias_fixicare" ADD CONSTRAINT "garantias_fixicare_reparadorId_fkey" FOREIGN KEY ("reparadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calificaciones_servicio" ADD CONSTRAINT "calificaciones_servicio_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calificaciones_servicio" ADD CONSTRAINT "calificaciones_servicio_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calificaciones_servicio" ADD CONSTRAINT "calificaciones_servicio_reparadorId_fkey" FOREIGN KEY ("reparadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_chat" ADD CONSTRAINT "mensajes_chat_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_chat" ADD CONSTRAINT "mensajes_chat_emisorId_fkey" FOREIGN KEY ("emisorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixi_wallets" ADD CONSTRAINT "fixi_wallets_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacciones_wallet" ADD CONSTRAINT "transacciones_wallet_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "fixi_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacciones_wallet" ADD CONSTRAINT "transacciones_wallet_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
