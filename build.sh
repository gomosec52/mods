#!/usr/bin/env bash
# Builds Kingdoms_v4.1.mcaddon from BP + RP packs
set -e

OUT="Kingdoms_v4.1.mcaddon"
rm -f "$OUT"
zip -r "$OUT" Kingdoms_BP Kingdoms_RP
echo "Built: $OUT ($(du -sh "$OUT" | cut -f1))"
