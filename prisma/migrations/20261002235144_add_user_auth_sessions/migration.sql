-- CreateTable
CREATE TABLE "sesiones_usuario" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "revocado" BOOLEAN NOT NULL DEFAULT false,
    "ipDireccion" VARCHAR(45),
    "userAgent" TEXT,
    "dispositivo" VARCHAR(100),
    "fechaExpira" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEn" TIMESTAMP(3),

    CONSTRAINT "sesiones_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_usuario_tokenHash_key" ON "sesiones_usuario"("tokenHash");

-- CreateIndex
CREATE INDEX "sesiones_usuario_usuarioId_revocado_idx" ON "sesiones_usuario"("usuarioId", "revocado");

-- CreateIndex
CREATE INDEX "sesiones_usuario_fechaExpira_idx" ON "sesiones_usuario"("fechaExpira");

-- AddForeignKey
ALTER TABLE "sesiones_usuario" ADD CONSTRAINT "sesiones_usuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
