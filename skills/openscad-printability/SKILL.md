---
name: openscad-printability
description: Screen an explicit millimeter FDM build envelope and triangle overhang candidates.
---

Require an explicit local print profile and frozen report with known mm units. Use `scad_ai_ide_model_checkPrintability`; select a single stable part for v3. Print pose applies to local geometry independently of assembly placement. Read envelope bounds, numerical overhang candidates, completeness and notChecked. This phase does not check wall thickness, bridges, support, slicer settings or manufacturing success; printability remains NOT_CHECKED. Do not create/edit a profile, change thresholds, repair a mesh or infer millimeters to obtain success. Profile changes require a new explicit baseline.
