-- CreateTable
CREATE TABLE "solicitudes_modulo" (
    "silo_slug" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "pedida_por_rol" TEXT NOT NULL,
    "pedida_en" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "estado_silo" TEXT NOT NULL,
    "respuesta" TEXT,
    "decidida_por" TEXT,
    "decidida_en" TIMESTAMP(3),
    "error_entrega" TEXT,
    "vista_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitudes_modulo_pkey" PRIMARY KEY ("silo_slug","id")
);

-- CreateIndex
CREATE INDEX "solicitudes_modulo_estado_idx" ON "solicitudes_modulo"("estado");
