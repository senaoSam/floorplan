# People models (3D CAMERA mode)

Source: Microsoft Rocketbox avatar library — https://github.com/microsoft/Microsoft-Rocketbox
(MIT, see `LICENSE-Rocketbox.md`).

| File | Source avatar |
|---|---|
| `person-m.glb` | `Assets/Avatars/Adults/Male_Adult_06` |
| `person-f.glb` | `Assets/Avatars/Adults/Female_Adult_03` |

Modifications from the original FBX + TGA:
- Converted with FBX2glTF; vertex colours (flat white) and the empty animation take removed.
- Textures downscaled and re-encoded as WebP (body/head colour 1024², normals 512², hair 512²).
- The body colour texture's ALPHA channel is a cloth mask (1 = garment, 0 = skin), derived by a
  skin-tone colour test. TrackLayer3D tints the garment with the tracking-state colour; it is not
  transparency (the material is OPAQUE).
- Geometry quantized (KHR_mesh_quantization).
