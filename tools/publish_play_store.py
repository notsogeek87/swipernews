#!/usr/bin/env python3
"""Publie un .aab sur un canal de test Google Play, via l'API Play Developer.

    PLAY_STORE_SERVICE_ACCOUNT_JSON='...' python3 tools/publish_play_store.py \
        --package eu.lielu.news --aab swipernews-1.5.7.aab --track alpha

Remplace l'action GitHub r0adkll/upload-google-play, sans rapport avec la
vraie cause trouvée : « Release in track targeting no countries » n'est PAS
résolu en posant countryTargeting sur la release (l'API le refuse d'ailleurs
explicitement hors production, quel que soit le status — confirmé par deux
erreurs différentes en testant). La cause réelle reste à déterminer : le
diagnostic ci-dessous (tracks.list, countryavailability.get avant/après,
tracks.get avant/après) sert précisément à trancher entre les hypothèses
avant de tenter un nouveau correctif à l'aveugle — voir l'historique git de
ce fichier pour le détail des tentatives déjà écartées.

Dépendances (installées à la volée par le workflow, pas dans package.json —
ce script ne s'exécute que dans ce job CI, jamais dans l'app ni les tests) :
google-api-python-client, google-auth.
"""
import argparse
import json
import os
import sys

from googleapiclient.errors import HttpError
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]


def dump(label, obj):
    print(f"--- {label} ---")
    print(json.dumps(obj, indent=2, ensure_ascii=False))


def try_call(label, fn):
    """Un diagnostic qui échoue ne doit jamais masquer les autres : on
    affiche l'erreur HTTP telle quelle et on continue."""
    try:
        dump(label, fn())
    except HttpError as e:
        print(f"--- {label} : ÉCHEC ---")
        print(e)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--package", required=True)
    p.add_argument("--aab", required=True)
    p.add_argument("--track", required=True)
    p.add_argument("--status", default="completed")
    args = p.parse_args()

    creds_json = os.environ.get("PLAY_STORE_SERVICE_ACCOUNT_JSON")
    if not creds_json:
        sys.exit("PLAY_STORE_SERVICE_ACCOUNT_JSON manquant dans l'environnement.")
    creds = service_account.Credentials.from_service_account_info(
        json.loads(creds_json), scopes=SCOPES
    )
    api = build("androidpublisher", "v3", credentials=creds, cache_discovery=False)
    edits = api.edits()

    edit_id = edits.insert(body={}, packageName=args.package).execute()["id"]
    print(f"Edit créé : {edit_id}")

    # 1. Les tracks tels que l'API les connaît VRAIMENT — vérifie que "alpha"
    #    est le bon identifiant et pas un track personnalisé sous un autre nom.
    try_call(
        "tracks.list()",
        lambda: edits.tracks().list(packageName=args.package, editId=edit_id).execute(),
    )

    # 2. Disponibilité pays AVANT toute modification, sur le track visé.
    try_call(
        "countryavailability.get() AVANT update",
        lambda: edits.countryavailability()
        .get(packageName=args.package, editId=edit_id, track=args.track)
        .execute(),
    )

    # 3. État du track avant remplacement.
    try_call(
        "tracks.get() AVANT update",
        lambda: edits.tracks()
        .get(packageName=args.package, editId=edit_id, track=args.track)
        .execute(),
    )

    # mimetype explicite : la détection automatique de MediaFileUpload se base
    # sur le module mimetypes de Python, qui ne connaît pas .aab (contrairement
    # à .zip dont c'est pourtant le format sous-jacent) — sans ça, l'upload
    # échoue avec UnknownFileType avant même de contacter l'API.
    media = MediaFileUpload(args.aab, mimetype="application/octet-stream")
    bundle = edits.bundles().upload(
        editId=edit_id, packageName=args.package, media_body=media
    ).execute()
    version_code = str(bundle["versionCode"])
    print(f"Bundle uploadé : versionCode {version_code}")

    # PAS de countryTargeting : confirmé invalide hors production (voir le
    # commentaire de module). release "normale", status completed.
    release = {"versionCodes": [version_code], "status": args.status}
    track_result = edits.tracks().update(
        editId=edit_id,
        packageName=args.package,
        track=args.track,
        body={"releases": [release]},
    ).execute()
    dump("tracks.update() résultat", track_result)

    # 5. Disponibilité pays APRÈS update — compare avec l'étape 2 : si les
    #    pays étaient là avant et ont disparu ici, update() les a écrasés.
    try_call(
        "countryavailability.get() APRÈS update",
        lambda: edits.countryavailability()
        .get(packageName=args.package, editId=edit_id, track=args.track)
        .execute(),
    )

    # 6. État final du track juste avant de committer.
    try_call(
        "tracks.get() JUSTE AVANT commit",
        lambda: edits.tracks()
        .get(packageName=args.package, editId=edit_id, track=args.track)
        .execute(),
    )

    # 7. Le commit lui-même, dernier maillon — celui qui échoue jusqu'ici.
    edits.commit(editId=edit_id, packageName=args.package).execute()
    print(f"Publié sur le canal « {args.track} » : versionCode {version_code}")


if __name__ == "__main__":
    main()
