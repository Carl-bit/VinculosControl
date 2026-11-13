-- AlterTable
ALTER TABLE "centros" ADD COLUMN     "aprobado_en" TIMESTAMP(3),
ADD COLUMN     "hash_aprobado" TEXT,
ADD COLUMN     "revision_aprobada" INTEGER;

-- CreateTable
CREATE TABLE "enlaces_fase2" (
    "id" SERIAL NOT NULL,
    "centro_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "enviado_a" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMP(3) NOT NULL,
    "revocado_en" TIMESTAMP(3),
    "ultimo_uso_en" TIMESTAMP(3),

    CONSTRAINT "enlaces_fase2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enlaces_fase2_token_hash_key" ON "enlaces_fase2"("token_hash");

-- CreateIndex
CREATE INDEX "enlaces_fase2_centro_id_idx" ON "enlaces_fase2"("centro_id");

-- AddForeignKey
ALTER TABLE "enlaces_fase2" ADD CONSTRAINT "enlaces_fase2_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
