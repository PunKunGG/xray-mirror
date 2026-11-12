"""Build registered BodyParts3D brain, head-muscle and eye GLBs.

Run with Blender 4.5.16 and the official BodyParts3D 4.0 reduced IS-A ZIP:
  blender --background --factory-startup --python scripts/convert-head-layers.py -- official.zip public/models
  blender --background --factory-startup --python scripts/convert-head-layers.py -- official.zip public/models eyes

All source vertices are converted from BodyParts3D millimetres to glTF metres.
The same source-space skull bounding-box origin and Y-up export conversion as
scripts/convert-skull.py are used, so the assets share one registration frame.
"""
import os
import sys
import zipfile

import bpy
from mathutils import Vector

ARCHIVE_ROOT = "isa_BP3D_4.0_obj_99"
DECIMATE_RATIOS = {"eyes": 0.35}

# Official compound mappings from the 20130619 LSDB Archive release.
# Brain (PART-OF FMA50801), muscle of head (IS-A FMA9616), bilateral eyeball
# (PART-OF FMA12514/FMA12515). The two eyes use just globe structures; the
# parent compound also lists extraocular muscles, which are represented in the
# head-muscle layer instead.
GROUPS = {
    "brain": {
        "path": "brain.glb", "fma": "FMA50801", "name": "Brain",
        "color": (0.62, 0.43, 0.56, 1.0), "roughness": 0.82,
        "files": "FJ1730 FJ1731 FJ1732 FJ1733 FJ1738 FJ1739 FJ1740 FJ1743 FJ1744 FJ1745 FJ1746 FJ1747 FJ1748 FJ1749 FJ1750 FJ1751 FJ1758 FJ1759 FJ1760 FJ1762 FJ1767 FJ1769 FJ1770 FJ1775 FJ1779 FJ1780 FJ1781 FJ1783 FJ1784 FJ1785 FJ1786 FJ1787 FJ1788 FJ1789 FJ1790 FJ1791 FJ1792 FJ1795 FJ1797 FJ1798 FJ1800 FJ1801 FJ1806 FJ1807 FJ1808 FJ1810 FJ1814 FJ1817 FJ1822 FJ1826 FJ1828 FJ1830 FJ1831 FJ1833 FJ1834 FJ1835 FJ1836 FJ1841 FJ1842".split(),
        "parts": {},
    },
    "muscles": {
        "path": "muscles.glb", "fma": "FMA9616", "name": "Head muscle",
        "color": (0.66, 0.19, 0.16, 1.0), "roughness": 0.8,
        "files": "FJ1294 FJ1295 FJ1304 FJ1306 FJ1308 FJ1322 FJ1323 FJ1345 FJ1346 FJ1355 FJ1357 FJ1359 FJ1373 FJ1374 FJ2738 FJ2739 FJ2741 FJ2748 FJ2750 FJ2751 FJ2753 FJ2760 FJ2762".split(),
        "parts": {},
    },
    "eyes": {
        "path": "eyes.glb", "fma": "FMA12514/FMA12515", "name": "Eyeball",
        "color": (0.90, 0.88, 0.81, 1.0), "roughness": 0.3,
        "files": "FJ1336 FJ1337 FJ1340 FJ1348 FJ1356 FJ1368 FJ1371 FJ1382 FJ1285 FJ1286 FJ1289 FJ1297 FJ1305 FJ1317 FJ1320 FJ1331".split(),
        "parts": {
            "FJ1317": "Sclera left", "FJ1368": "Sclera right",
            "FJ1297": "Iris left", "FJ1348": "Iris right",
            "FJ1289": "Cornea left", "FJ1340": "Cornea right",
            "FJ1305": "Lens left", "FJ1356": "Lens right",
            "FJ1331": "Vitreous body left", "FJ1382": "Vitreous body right",
            "FJ1285": "Choroid left", "FJ1286": "Choroid left",
            "FJ1336": "Choroid right anterior", "FJ1337": "Choroid right posterior",
            "FJ1320": "Suspensory ligament left", "FJ1371": "Suspensory ligament right",
        },
    },
}

# Exact shared origin from the Phase 2 assembled skull bounds, in BodyParts3D
# source coordinates (metres, before Blender's export_yup rotation).
SKULL_ORIGIN_M = (-0.0006659999489784241, -0.08641599863767624, 1.5289499759674072)


def args_after_separator():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) not in (2, 3):
        raise SystemExit("Usage: blender --background --python scripts/convert-head-layers.py -- official.zip output-directory [brain|muscles|eyes]")
    selected = [args[2]] if len(args) == 3 else list(GROUPS)
    unknown = set(selected) - set(GROUPS)
    if unknown:
        raise SystemExit(f"Unknown group(s): {', '.join(sorted(unknown))}")
    return os.path.abspath(args[0]), os.path.abspath(args[1]), selected


def component_material(group_key, file_id):
    layer = GROUPS[group_key]
    name = layer["parts"].get(file_id, layer["name"])
    alpha = 1.0
    if group_key == "eyes":
        if name.startswith("Iris"):
            color, roughness = (0.22, 0.13, 0.08, 1.0), 0.34
        elif name.startswith("Sclera"):
            color, roughness = (0.93, 0.91, 0.84, 1.0), 0.3
        elif name.startswith("Cornea"):
            color, roughness = (0.72, 0.84, 0.91, 1.0), 0.12
            alpha = 0.22
        elif name.startswith("Lens"):
            color, roughness = (0.78, 0.81, 0.77, 1.0), 0.24
        elif name.startswith("Vitreous"):
            color, roughness = (0.82, 0.85, 0.83, 1.0), 0.22
        elif name.startswith("Choroid"):
            color, roughness = (0.36, 0.13, 0.12, 1.0), 0.56
        elif name.startswith("Suspensory"):
            color, roughness = (0.70, 0.61, 0.49, 1.0), 0.66
        else:
            color, roughness = (0.93, 0.91, 0.84, 1.0), 0.3
    else:
        color, roughness = layer["color"], layer["roughness"]
    mat_name = name
    material = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
    material.diffuse_color = color
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0.0
    if "Alpha" in shader.inputs:
        shader.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        material.surface_render_method = "DITHERED"
    return name, material


def import_component(archive, group_key, file_id):
    layer = GROUPS[group_key]
    vertices, normals, faces = [], [], []
    with archive.open(f"{ARCHIVE_ROOT}/{file_id}.obj") as source:
        for raw in source:
            line = raw.decode("ascii")
            if line.startswith("v "):
                vertices.append(tuple(map(float, line.split()[1:4])))
            elif line.startswith("vn "):
                normals.append(tuple(map(float, line.split()[1:4])))
            elif line.startswith("f "):
                refs = []
                for reference in line.split()[1:]:
                    fields = reference.split("/")
                    refs.append((int(fields[0]) - 1, int(fields[2]) - 1 if len(fields) > 2 and fields[2] else -1))
                for i in range(1, len(refs) - 1):
                    faces.append((refs[0], refs[i], refs[i + 1]))

    unique_vertices, unique_normals, polygons, indices = [], [], [], {}
    for face in faces:
        polygon = []
        for vertex_index, normal_index in face:
            key = (vertex_index, normal_index)
            if key not in indices:
                x, y, z = vertices[vertex_index]
                indices[key] = len(unique_vertices)
                unique_vertices.append((
                    x * 0.001 - SKULL_ORIGIN_M[0],
                    y * 0.001 - SKULL_ORIGIN_M[1],
                    z * 0.001 - SKULL_ORIGIN_M[2],
                ))
                unique_normals.append(normals[normal_index] if normal_index >= 0 else (0.0, 0.0, 0.0))
            polygon.append(indices[key])
        polygons.append(tuple(polygon))

    part_name, material = component_material(group_key, file_id)
    mesh = bpy.data.meshes.new(f"{part_name} {file_id}")
    mesh.from_pydata(unique_vertices, [], polygons)
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True
    if any(any(value != 0.0 for value in n) for n in unique_normals):
        mesh.normals_split_custom_set_from_vertices(unique_normals)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(f"{part_name} {file_id}", mesh)
    bpy.context.collection.objects.link(obj)
    obj["layer_fma_id"] = layer["fma"]
    obj["bodyparts3d_file_id"] = file_id
    obj["bodyparts3d_component_name"] = part_name
    return len(faces)


def main():
    archive_path, output_dir, selected_groups = args_after_separator()
    os.makedirs(output_dir, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        members = set(archive.namelist())
        for group_key in selected_groups:
            layer = GROUPS[group_key]
            bpy.ops.object.select_all(action="SELECT")
            bpy.ops.object.delete(use_global=False)
            triangles = 0
            for file_id in layer["files"]:
                member = f"{ARCHIVE_ROOT}/{file_id}.obj"
                if member not in members:
                    raise FileNotFoundError(f"{member} missing from {archive_path}")
                triangles += import_component(archive, group_key, file_id)
            if group_key in DECIMATE_RATIOS:
                source_triangles = triangles
                ratio = DECIMATE_RATIOS[group_key]
                for obj in bpy.context.scene.objects:
                    if obj.type == "MESH":
                        modifier = obj.modifiers.new("Source polygon reduction", "DECIMATE")
                        modifier.ratio = ratio
                        bpy.context.view_layer.objects.active = obj
                        obj.select_set(True)
                        bpy.ops.object.modifier_apply(modifier=modifier.name)
                        obj.select_set(False)
                bpy.context.view_layer.update()
                triangles = sum(len(obj.data.polygons) for obj in bpy.context.scene.objects if obj.type == "MESH")
            else:
                source_triangles = triangles
            output_path = os.path.join(output_dir, layer["path"])
            bpy.ops.object.select_all(action="SELECT")
            bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
            bpy.ops.export_scene.gltf(
                filepath=output_path, export_format="GLB", use_selection=True,
                export_normals=True, export_materials="EXPORT", export_yup=True,
            )
            print("HEAD_LAYER_METRICS", group_key, {
                "meshes": len(layer["files"]), "triangles": triangles,
                "source_triangles": source_triangles,
                "glb_bytes": os.path.getsize(output_path),
                "origin_source_m": SKULL_ORIGIN_M,
                "glb_origin_m": (SKULL_ORIGIN_M[0], SKULL_ORIGIN_M[2], -SKULL_ORIGIN_M[1]),
            })


if __name__ == "__main__":
    main()
