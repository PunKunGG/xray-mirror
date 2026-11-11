"""Build public/models/skull.glb from the official BodyParts3D 4.0 OBJ archive.

Run with Blender 4.5.16 (portable ZIP works):
  blender --background --factory-startup --python scripts/convert-skull.py -- official.zip public/models/skull.glb

Reads only the FJ files mapped below. BodyParts3D coordinates are millimetres,
Z-up and anterior -Y. The output uses glTF metres, Y-up and anterior +Z. One
common origin at the assembled skull bounding-box center is applied to every
part; no per-part geometry transformations are made.
"""
import os
import sys
import zipfile

import bpy
from mathutils import Vector

ARCHIVE_ROOT = "isa_BP3D_4.0_obj_99"
BONES = (
    ("Frontal bone", "FMA52734", "FJ3200"),
    ("Parietal bone left", "FMA9613", "FJ3274"),
    ("Parietal bone right", "FMA9613", "FJ3380"),
    ("Temporal bone left", "FMA52737", "FJ3281"),
    ("Temporal bone right", "FMA52737", "FJ3386"),
    ("Occipital bone", "FMA52735", "FJ3309"),
    ("Sphenoid bone", "FMA52736", "FJ3394"),
    ("Ethmoid bone", "FMA52740", "FJ3199"),
    ("Lacrimal bone left", "FMA52741", "FJ3265"),
    ("Lacrimal bone right", "FMA52741", "FJ3371"),
    ("Nasal bone left", "FMA52745", "FJ3272"),
    ("Nasal bone right", "FMA52745", "FJ3378"),
    ("Palatine bone left", "FMA52746", "FJ3273"),
    ("Palatine bone right", "FMA52746", "FJ3379"),
    ("Zygomatic bone left", "FMA52747", "FJ3287"),
    ("Zygomatic bone right", "FMA52747", "FJ3392"),
    ("Mandible", "FMA52748", "FJ3289"),
    ("Inferior nasal concha left", "FMA54736", "FJ3263"),
    ("Inferior nasal concha right", "FMA54736", "FJ3369"),
    ("Vomer", "FMA9710", "FJ3395"),
    ("Maxilla left", "FMA9711", "FJ3269"),
    ("Maxilla right", "FMA9711", "FJ3375"),
)


def arguments():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(values) != 2:
        raise SystemExit("Usage: blender --background --python scripts/convert-skull.py -- official.zip output.glb")
    return os.path.abspath(values[0]), os.path.abspath(values[1])


def load_obj(obj_zip, part_name, fma_id, file_id):
    vertices, normals, faces = [], [], []
    with obj_zip.open(f"{ARCHIVE_ROOT}/{file_id}.obj") as source:
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
                for index in range(1, len(refs) - 1):
                    faces.append((refs[0], refs[index], refs[index + 1]))

    # Split vertices at OBJ normal seams so source normals survive conversion.
    keyed_vertices, keyed_normals, polygons, index_by_ref = [], [], [], {}
    for triangle in faces:
        polygon = []
        for vertex_index, normal_index in triangle:
            key = (vertex_index, normal_index)
            if key not in index_by_ref:
                x, y, z = vertices[vertex_index]
                index_by_ref[key] = len(keyed_vertices)
                # Keep source axis values here: glTF export_yup performs the one
                # required Z-up -> Y-up coordinate conversion for the whole scene.
                keyed_vertices.append((x * .001, y * .001, z * .001))
                if normal_index >= 0:
                    nx, ny, nz = normals[normal_index]
                    keyed_normals.append((nx, ny, nz))
                else:
                    keyed_normals.append((0.0, 0.0, 0.0))
            polygon.append(index_by_ref[key])
        polygons.append(tuple(polygon))

    mesh = bpy.data.meshes.new(part_name)
    mesh.from_pydata(keyed_vertices, [], polygons)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if any(any(value != 0 for value in normal) for normal in keyed_normals):
        mesh.normals_split_custom_set_from_vertices(keyed_normals)
    obj = bpy.data.objects.new(part_name, mesh)
    bpy.context.collection.objects.link(obj)
    obj["fma_concept_id"] = fma_id
    obj["bodyparts3d_file_id"] = file_id
    return len(faces)


def main():
    archive_path, output_path = arguments()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    total_triangles = 0
    with zipfile.ZipFile(archive_path) as archive:
        members = set(archive.namelist())
        for part_name, fma_id, file_id in BONES:
            member = f"{ARCHIVE_ROOT}/{file_id}.obj"
            if member not in members:
                raise FileNotFoundError(f"{member} ({fma_id}, {part_name}) missing from {archive_path}")
            total_triangles += load_obj(archive, part_name, fma_id, file_id)

    material = bpy.data.materials.new("Neutral bone")
    material.diffuse_color = (0.78, 0.70, 0.55, 1.0)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (0.78, 0.70, 0.55, 1.0)
    shader.inputs["Roughness"].default_value = 0.8
    shader.inputs["Metallic"].default_value = 0.0
    for obj in bpy.context.scene.objects:
        obj.data.materials.append(material)

    # Compute a common bbox center in transformed metres, then apply only translation.
    corners = [obj.matrix_world @ Vector(corner) for obj in bpy.context.scene.objects
               if obj.type == "MESH" for corner in obj.bound_box]
    lower = Vector(tuple(min(p[i] for p in corners) for i in range(3)))
    upper = Vector(tuple(max(p[i] for p in corners) for i in range(3)))
    origin = (lower + upper) * 0.5
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            for vertex in obj.data.vertices:
                vertex.co -= origin
            obj.data.update()

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.export_scene.gltf(
        filepath=output_path, export_format="GLB", use_selection=True,
        export_normals=True, export_materials="EXPORT", export_yup=True,
    )
    print("SKULL_METRICS", {
        "bounds_before_centering_m": (tuple(lower), tuple(upper)),
        "origin_before_centering_m": tuple(origin),
        # Blender's glTF exporter applies (x,y,z) -> (x,z,-y) when export_yup=True.
        "bounds_after_centering_m": (
            (lower.x-origin.x, lower.z-origin.z, -(upper.y-origin.y)),
            (upper.x-origin.x, upper.z-origin.z, -(lower.y-origin.y)),
        ),
        "meshes": len(BONES), "triangles": total_triangles,
    })


if __name__ == "__main__":
    main()
