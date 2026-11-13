-- CreateTable
CREATE TABLE "operadores" (
    "id" SERIAL NOT NULL,
    "correo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "clave_hash" TEXT NOT NULL,
    "fallos" INTEGER NOT NULL DEFAULT 0,
    "bloqueada_hasta" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigos_acceso" (
    "id" TEXT NOT NULL,
    "operador_id" INTEGER NOT NULL,
    "codigo_hmac" TEXT NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "enviado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reenvios" INTEGER NOT NULL DEFAULT 0,
    "vence_en" TIMESTAMP(3) NOT NULL,
    "usado_en" TIMESTAMP(3),
    "ip" TEXT,

    CONSTRAINT "codigos_acceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" SERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "operador_id" INTEGER NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultima_actividad" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocada_en" TIMESTAMP(3),
    "ip" TEXT,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_auditoria" (
    "id" BIGSERIAL NOT NULL,
    "en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "objeto" TEXT,
    "detalle" TEXT,

    CONSTRAINT "eventos_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operadores_correo_key" ON "operadores"("correo");

-- CreateIndex
CREATE INDEX "codigos_acceso_operador_id_idx" ON "codigos_acceso"("operador_id");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_token_hash_key" ON "sesiones"("token_hash");

-- CreateIndex
CREATE INDEX "sesiones_operador_id_creada_en_idx" ON "sesiones"("operador_id", "creada_en");

-- CreateIndex
CREATE INDEX "eventos_auditoria_en_idx" ON "eventos_auditoria"("en");

-- CreateIndex
CREATE INDEX "eventos_auditoria_accion_en_idx" ON "eventos_auditoria"("accion", "en");

-- AddForeignKey
ALTER TABLE "codigos_acceso" ADD CONSTRAINT "codigos_acceso_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "operadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "operadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
