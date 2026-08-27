#!/usr/bin/env python3
"""Publie un .aab sur un canal de test Google Play, via l'API Play Developer.

    PLAY_STORE_SERVICE_ACCOUNT_JSON='...' python3 tools/publish_play_store.py \
        --package eu.lielu.news --aab swipernews-1.5.7.aab --track Swipernews

Remplace l'action GitHub r0adkll/upload-google-play : elle ne permet pas de
lister les tracks réels de l'app, ce qui a coûté plusieurs itérations avant
de trouver la vraie cause d'un « Release in track targeting no countries »
systématique — le canal visé (--track alpha) n'était simplement pas le bon.
Play Console nomme le premier canal de tests fermés créé d'après le nom de
l'app au moment de sa création ("Swipernews" ici), pas "alpha" (le nom
historique de Google, qui existe bien côté API mais reste un canal à part,
vide). Trouvé en ajoutant edits.tracks().list() juste après edits.insert() —
à relancer en diagnostic si ce canal est un jour renommé ou recréé.

Dépendances (installées à la volée par le workflow, pas dans package.json —
ce script ne s'exécute que dans ce job CI, jamais dans l'app ni les tests) :
google-api-python-client, google-auth.
"""
import argparse
import json
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]


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

    # Vérification bon marché avant d'aller plus loin : un nom de track faux
    # échouerait sinon seulement au commit, après l'upload complet du bundle.
    tracks = edits.tracks().list(packageName=args.package, editId=edit_id).execute()
    known = [t["track"] for t in tracks.get("tracks", [])]
    if args.track not in known:
        sys.exit(f"Track « {args.track} » introuvable. Tracks connus : {known}")

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

    # PAS de countryTargeting : invalide hors production quel que soit le
    # status (confirmé par l'API elle-même en le testant).
    edits.tracks().update(
        editId=edit_id,
        packageName=args.package,
        track=args.track,
        body={"releases": [{"versionCodes": [version_code], "status": args.status}]},
    ).execute()

    edits.commit(editId=edit_id, packageName=args.package).execute()
    print(f"Publié sur le canal « {args.track} » : versionCode {version_code}")


if __name__ == "__main__":
    main()
