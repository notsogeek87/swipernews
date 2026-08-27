#!/usr/bin/env python3
"""Publie un .aab sur un canal de test Google Play, via l'API Play Developer.

    PLAY_STORE_SERVICE_ACCOUNT_JSON='...' python3 tools/publish_play_store.py \
        --package eu.lielu.news --aab swipernews-1.5.7.aab --track alpha

Remplace l'action GitHub r0adkll/upload-google-play : celle-ci ne fixe jamais
le ciblage pays d'une release qu'elle crée, quel que soit ce qui est déjà
configuré dans Play Console pour le canal — l'API renvoie alors « Release in
track targeting no countries » au moment de committer l'edit, même sur un
canal qui affiche déjà 177 pays actifs (releases précédentes, faites à la
main). Un appel direct à l'API permet de fixer countryTargeting explicitement
sur CETTE release, plutôt que de dépendre d'un héritage que l'API ne fait
visiblement pas toute seule.

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

    # mimetype explicite : la détection automatique de MediaFileUpload se base
    # sur le module mimetypes de Python, qui ne connaît pas .aab (contrairement
    # à .zip dont c'est pourtant le format sous-jacent) — sans ça, l'upload
    # échoue avec UnknownFileType avant même de contacter l'API.
    media = MediaFileUpload(args.aab, mimetype="application/octet-stream")
    bundle = edits.bundles().upload(
        editId=edit_id, packageName=args.package, media_body=media
    ).execute()
    version_code = bundle["versionCode"]
    print(f"Bundle uploadé : versionCode {version_code}")

    # PAS de countryTargeting ici : l'API le rejette explicitement pour un
    # status "completed" (« Country targeting is only supported for staged
    # releases » — seul un déploiement progressif, userFraction < 1, peut le
    # porter). Une release complète hérite de la disponibilité par pays de
    # l'app (Présence sur le Store), déjà réglée — ce n'est pas ce qui a causé
    # « Release in track targeting no countries » avec l'action précédente ;
    # cette erreur-là venait d'ailleurs (elle ne posait AUCUN champ pays du
    # tout, ni countryTargeting ni le format attendu par l'API pour l'hériter).
    edits.tracks().update(
        editId=edit_id,
        packageName=args.package,
        track=args.track,
        body={
            "releases": [
                {
                    "versionCodes": [str(version_code)],
                    "status": args.status,
                }
            ]
        },
    ).execute()

    edits.commit(editId=edit_id, packageName=args.package).execute()
    print(f"Publié sur le canal « {args.track} » : versionCode {version_code}")


if __name__ == "__main__":
    main()
