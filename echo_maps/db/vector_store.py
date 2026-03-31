"""Milvus vector database integration for RF Signature storage.

Stores environment-specific CSI latent embeddings so that when a user
returns to a previously calibrated Place, the system can load the
multipath interference profile and resume accurate sensing immediately.
"""

from __future__ import annotations

import numpy as np
import structlog
from pymilvus import (
    Collection,
    CollectionSchema,
    DataType,
    FieldSchema,
    connections,
    utility,
)

logger = structlog.get_logger()

# Schema constants
COLLECTION_NAME = "rf_signatures"
VECTOR_DIM = 512


def connect_milvus(host: str = "localhost", port: int = 19530) -> None:
    """Establish connection to Milvus vector database."""
    connections.connect("default", host=host, port=str(port))
    logger.info("milvus_connected", host=host, port=port)


def ensure_collection() -> Collection:
    """Create the RF signatures collection if it doesn't exist."""
    if utility.has_collection(COLLECTION_NAME):
        collection = Collection(COLLECTION_NAME)
        collection.load()
        return collection

    fields = [
        FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
        FieldSchema(name="environment_id", dtype=DataType.VARCHAR, max_length=36),
        FieldSchema(name="user_id", dtype=DataType.VARCHAR, max_length=36),
        FieldSchema(name="label", dtype=DataType.VARCHAR, max_length=100),
        FieldSchema(name="timestamp", dtype=DataType.INT64),
        FieldSchema(
            name="embedding",
            dtype=DataType.FLOAT_VECTOR,
            dim=VECTOR_DIM,
        ),
    ]

    schema = CollectionSchema(fields, description="RF signature embeddings per environment")
    collection = Collection(COLLECTION_NAME, schema)

    # Create IVF_FLAT index for fast similarity search
    index_params = {
        "metric_type": "COSINE",
        "index_type": "IVF_FLAT",
        "params": {"nlist": 128},
    }
    collection.create_index("embedding", index_params)
    collection.load()

    logger.info("milvus_collection_created", name=COLLECTION_NAME)
    return collection


def store_rf_signature(
    collection: Collection,
    environment_id: str,
    user_id: str,
    embedding: np.ndarray,
    label: str = "calibration",
    timestamp: int = 0,
) -> None:
    """Store an RF signature embedding for a specific environment.

    Args:
        collection: Milvus collection handle
        environment_id: UUID of the environment/Place
        user_id: UUID of the owning user
        embedding: (512,) float32 latent vector from LatentCSI encoder
        label: descriptive label (e.g., "calibration", "idle", "walking")
        timestamp: Unix timestamp in milliseconds
    """
    if embedding.shape != (VECTOR_DIM,):
        raise ValueError(f"Expected embedding dim {VECTOR_DIM}, got {embedding.shape}")

    data = [
        [environment_id],
        [user_id],
        [label],
        [timestamp],
        [embedding.tolist()],
    ]
    collection.insert(data)
    logger.debug(
        "rf_signature_stored",
        environment_id=environment_id,
        label=label,
    )


def query_rf_signatures(
    collection: Collection,
    query_embedding: np.ndarray,
    environment_id: str,
    top_k: int = 10,
) -> list[dict]:
    """Find the closest RF signatures to a query embedding.

    Used to look up the multipath profile when resuming monitoring
    in a previously calibrated environment.

    Returns list of dicts with 'id', 'label', 'distance', 'timestamp'.
    """
    if query_embedding.shape != (VECTOR_DIM,):
        raise ValueError(f"Expected embedding dim {VECTOR_DIM}, got {query_embedding.shape}")

    results = collection.search(
        data=[query_embedding.tolist()],
        anns_field="embedding",
        param={"metric_type": "COSINE", "params": {"nprobe": 16}},
        limit=top_k,
        expr=f'environment_id == "{environment_id}"',
        output_fields=["label", "timestamp", "environment_id"],
    )

    matches = []
    for hit in results[0]:
        matches.append({
            "id": hit.id,
            "label": hit.entity.get("label"),
            "timestamp": hit.entity.get("timestamp"),
            "distance": hit.distance,
        })
    return matches


def delete_environment_signatures(
    collection: Collection,
    environment_id: str,
) -> None:
    """Delete all RF signatures for an environment (e.g., on re-calibration)."""
    collection.delete(f'environment_id == "{environment_id}"')
    logger.info("rf_signatures_deleted", environment_id=environment_id)
