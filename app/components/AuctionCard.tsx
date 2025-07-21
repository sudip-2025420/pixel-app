"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/context/AuthContext";
import { Product } from "../types/productTypes";
import { AuctionZone } from "../types/AuctionZoneTypes";

export default function AuctionCard({ config, products }: any) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const [hoveredZone, setHoveredZone] = useState<any | null>(null);
  const [hoveredProduct, setHoveredProduct] = useState<Product | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [renderedProducts, setRenderedProducts] = useState<Set<string>>(new Set());
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const [auctionZones, setAuctionZones] = useState<any[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentSelection, setCurrentSelection] = useState<AuctionZone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [auctionDuration, setAuctionDuration] = useState<number>(7);
  const [showAuctionModal, setShowAuctionModal] = useState(false);
  const [pixelPrice, setPixelPrice] = useState<number>(0);
  const [buyNowPrice, setBuyNowPrice] = useState<number>(config?.oneTimePrice);
  const [viewX, setViewX] = useState(0);
  const [viewY, setViewY] = useState(0);
  const [showOverlapAlert, setShowOverlapAlert] = useState(false);
  const isAuthUser = !!user;
  const pixelSize = 12;
  const cols = 10000;
  const rows = 1000;
  const windowWidth = window.innerWidth || 1366;
  const windowHeight = window.innerHeight || 1920;
  const viewSize = Math.max(windowWidth, windowHeight) / pixelSize;
  const productMap = useRef<Record<number, Product>>({});

  // Improved overlap detection
  const isAreaOverlapping = useCallback(
    (x: number, y: number, width: number, height: number): boolean => {
      for (const zone of auctionZones) {
        const isOverlapping =
          x < zone.x + zone.width &&
          x + width > zone.x &&
          y < zone.y + zone.height &&
          y + height > zone.y;

        if (isOverlapping) {
          return true;
        }
      }
      return false;
    },
    [auctionZones]
  );

  // Show overlap alert and hide after delay
  const showOverlapWarning = useCallback(() => {
    if (!showOverlapAlert) {
      setShowOverlapAlert(true);
      setTimeout(() => setShowOverlapAlert(false), 2000);
    }
  }, [showOverlapAlert]);

  useEffect(() => {
    if (config?.auctionZones) {
      setBuyNowPrice(config?.oneTimePrice);
      const now = new Date();
      const zones = config.auctionZones
        .map((zone: any) => ({
          ...zone,
          id: zone._id || `zone-${Date.now()}`,
          products: products.find((p: any) => p.zoneId === zone._id),
          isEmpty: zone.isEmpty || false,
          status: zone.status || "active",
          auctionEndDate:
            zone.auctionEndDate ||
            new Date(
              Date.now() + (zone.auctionDuration || 7) * 24 * 60 * 60 * 1000
            ).toISOString(),
          totalPixels: zone.width * zone.height,
          pixelPrice: zone.pixelPrice || 0.01,
        }))
        .filter((zone: any) => {
          if (zone.auctionEndDate && new Date(zone.auctionEndDate) < now) {
            return false;
          }
          return true;
        });
      setAuctionZones(zones);
      drawCanvas();
    }
  }, [config, products]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const updatedZones = auctionZones
        .map((zone: any) => {
          if (
            zone.status === "active" &&
            zone.auctionEndDate &&
            new Date(zone.auctionEndDate) < now
          ) {
            return { ...zone, status: "expired" };
          }
          return zone;
        })
        .filter((zone) => {
          if (zone.status === "expired" && zone.auctionEndDate) {
            const expiredTime = new Date(zone.auctionEndDate).getTime();
            return now.getTime() - expiredTime < 3600000;
          }
          return true;
        });

      if (updatedZones.length !== auctionZones.length) {
        setAuctionZones(updatedZones);
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [auctionZones]);

  const minBuyNowPrice = config?.oneTimePrice ?? 20;

  const findProductsInArea = useCallback(
    (x: number, y: number, width: number, height: number): Product[] => {
      const productSet = new Set<Product>();

      products?.forEach((product: any) => {
        if (
          product.pixelIndex !== undefined &&
          product.pixelCount !== undefined
        ) {
          const productX = product.pixelIndex % cols;
          const productY = Math.floor(product.pixelIndex / cols);
          const productWidth = product.pixelCount;
          const productHeight = 1;

          if (
            productX + productWidth > x &&
            productX < x + width &&
            productY + productHeight > y &&
            productY < y + height
          ) {
            productSet.add(product);
          }
        }
      });

      return Array.from(productSet);
    },
    [products]
  );

  const isEmptyArea = useCallback(
    (x: number, y: number, width: number, height: number): boolean => {
      const overlappingProducts = findProductsInArea(x, y, width, height);
      return overlappingProducts.length === 0;
    },
    [findProductsInArea]
  );

  useEffect(() => {
    auctionZones.forEach((zone) => {
      if (zone?.products?.images) {
        const img = zone?.products?.images[0] || null;
        if (!imageCache.current[zone._id]) {
          laodImage(img, zone._id);
        }
      }
    });
  }, [auctionZones]);

  const laodImage = (img: string, aId: string) => {
    const dummyImg = new Image();
    dummyImg.src = img;
    imageCache.current[aId] = dummyImg;
  };

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const viewWidth = viewSize * pixelSize;
    const viewHeight = viewSize * pixelSize;
    canvas.width = viewWidth;
    canvas.height = viewHeight;

    // Draw white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid lines within view window
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 0.5;
    for (let col = viewX; col <= viewX + viewSize; col++) {
      ctx.beginPath();
      ctx.moveTo((col - viewX) * pixelSize, 0);
      ctx.lineTo((col - viewX) * pixelSize, viewHeight);
      ctx.stroke();
    }
    for (let row = viewY; row <= viewY + viewSize; row++) {
      ctx.beginPath();
      ctx.moveTo(0, (row - viewY) * pixelSize);
      ctx.lineTo(viewWidth, (row - viewY) * pixelSize);
      ctx.stroke();
    }

    // Draw auction zones in view
    auctionZones.forEach((zone) => {
      if (
        zone.x + zone.width >= viewX &&
        zone.y + zone.height >= viewY &&
        zone.x <= viewX + viewSize &&
        zone.y <= viewY + viewSize
      ) {
        const zoneX = (zone.x - viewX) * pixelSize;
        const zoneY = (zone.y - viewY) * pixelSize;
        const zoneWidth = zone.width * pixelSize;
        const zoneHeight = zone.height * pixelSize;

        let fillColor;
        if (zone.status === "sold") {
          fillColor = "rgba(0, 200, 0, 0.2)";
        } else if (zone.status === "expired") {
          fillColor = "rgba(255, 0, 0, 0.2)";
        } else if (zone?.bids?.length) {
          fillColor = "rgba(255, 111, 0, 0.52)";
        } else {
          fillColor = "rgba(20, 81, 171, 0.2)";
        }

        ctx.fillStyle = fillColor;
        ctx.fillRect(zoneX, zoneY, zoneWidth, zoneHeight);

        const img = imageCache.current[zone._id];
        if (img) {
          if (img.complete) {
            ctx.drawImage(img, zoneX, zoneY, zoneWidth, zoneHeight);
          } else {
            img.onload = () => {
              ctx.drawImage(img, zoneX, zoneY, zoneWidth, zoneHeight);
            };
          }
        }

        ctx.strokeStyle =
          zone.status === "sold"
            ? "#00c800"
            : zone.status === "expired"
            ? "#c80000"
            : zone.bids?.length
            ? "rgb(255, 111, 0)"
            : "#0064ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(zoneX, zoneY, zoneWidth, zoneHeight);

        if (zone.width > 5 && zone.height > 5) {
          ctx.fillStyle =
            zone.status === "sold"
              ? "#004d00"
              : zone.status === "expired"
              ? "#800000"
              : zone.bids?.length
              ? "rgb(255, 111, 0)"
              : "#003366";
          ctx.font = "bold 12px Arial";
          ctx.textAlign = "center";

          if (zone.auctionEndDate && zone.isEmpty) {
            ctx.fillText(
              `${zone.width}x${zone.height} (${zone.totalPixels}px)`,
              zoneX + zoneWidth / 2,
              zoneY + zoneHeight / 2
            );
            const endDate = new Date(zone.auctionEndDate);
            const daysLeft = Math.ceil(
              (endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
            ctx.fillText(
              `Ends in ${daysLeft}d`,
              zoneX + zoneWidth / 2,
              zoneY + zoneHeight / 2 + 15
            );
          }
        }
      }
    });

    // Draw current selection in view
    if (isAuthUser && currentSelection) {
      const selX = (currentSelection.x - viewX) * pixelSize;
      const selY = (currentSelection.y - viewY) * pixelSize;

      // Check if current selection overlaps with any existing zone
      const isOverlapping = isAreaOverlapping(
        currentSelection.x,
        currentSelection.y,
        currentSelection.width,
        currentSelection.height
      );

      ctx.fillStyle = isOverlapping
        ? "rgba(255, 0, 0, 0.3)"
        : "rgba(0, 100, 255, 0.3)";
      ctx.fillRect(
        selX,
        selY,
        currentSelection.width * pixelSize,
        currentSelection.height * pixelSize
      );

      ctx.strokeStyle = isOverlapping ? "#ff0000" : "#0064ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        selX,
        selY,
        currentSelection.width * pixelSize,
        currentSelection.height * pixelSize
      );

      // Show alert if overlapping during drag
      if (isDragging && isOverlapping) {
        showOverlapWarning();
      }
    }

    // Draw products in view
    const renderedProductIds = new Set<string>();
    products?.forEach((product: any) => {
      if (
        !renderedProductIds.has(product._id) &&
        renderedProducts.has(product._id)
      ) {
        renderedProductIds.add(product._id);
        const img = imageCache.current["auctionZoneImage"];

        if (
          img?.complete &&
          product.pixelIndex !== undefined &&
          product.pixelCount !== undefined
        ) {
          const x = product.pixelIndex % cols;
          const y = Math.floor(product.pixelIndex / cols);
          const width = product.pixelCount;
          const height = 1;

          if (
            x + width >= viewX &&
            y + height >= viewY &&
            x <= viewX + viewSize &&
            y <= viewY + viewSize
          ) {
            const px = (x - viewX) * pixelSize;
            const py = (y - viewY) * pixelSize;

            ctx.drawImage(img, px, py, width * pixelSize, height * pixelSize);

            const isInAuctionZone = auctionZones.some(
              (zone) =>
                x >= zone.x &&
                x + width <= zone.x + zone.width &&
                y >= zone.y &&
                y + height <= zone.y + zone.height
            );

            if (isInAuctionZone) {
              ctx.strokeStyle =
                product.purchaseType === "bid" ? "#ff9900" : "#00cc00";
              ctx.lineWidth = 1;
              ctx.strokeRect(px, py, width * pixelSize, height * pixelSize);
            }
          }
        }
      }
    });
  }, [
    products,
    renderedProducts,
    auctionZones,
    isAuthUser,
    currentSelection,
    viewX,
    viewY,
    isAreaOverlapping,
    isDragging,
    showOverlapWarning,
  ]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isAuthUser) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / pixelSize);
    const y = Math.floor((e.clientY - rect.top) / pixelSize);

    setIsDragging(true);
    setDragStart({ x, y });
    setCurrentSelection({
      id: "temp-" + Date.now(),
      x,
      y,
      width: 1,
      height: 1,
      products: [],
      isEmpty: true,
      status: "active",
      totalPixels: 1,
      pixelPrice: pixelPrice,
      buyNowPrice: buyNowPrice,
    });
    setError(null);
    setShowOverlapAlert(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setHoverPosition({ x: e.clientX, y: e.clientY });

    if (isAuthUser && isDragging && dragStart) {
      const x = Math.floor(mouseX / pixelSize);
      const y = Math.floor(mouseY / pixelSize);
      const width = Math.max(1, Math.abs(x - dragStart.x) + 1);
      const height = Math.max(1, Math.abs(y - dragStart.y) + 1);
      const startX = Math.min(dragStart.x, x);
      const startY = Math.min(dragStart.y, y);

      const productsInArea = findProductsInArea(startX, startY, width, height);
      const isEmpty = isEmptyArea(startX, startY, width, height);
      const totalPixels = width * height;

      setCurrentSelection({
        id: "temp-" + Date.now(),
        x: startX,
        y: startY,
        width,
        height,
        products: productsInArea,
        isEmpty,
        status: "active",
        totalPixels,
        pixelPrice: pixelPrice,
      });
      return;
    }

    const x = Math.floor(mouseX / pixelSize);
    const y = Math.floor(mouseY / pixelSize);

    // Check for product hover
    const product = productMap.current[y * cols + x];
    if (product) {
      setHoveredProduct(product);
      setHoveredZone(null);
      return;
    }

    setHoveredProduct(null);

    const hovered = auctionZones.find(
      (zone) =>
        x >= zone.x &&
        x < zone.x + zone.width &&
        y >= zone.y &&
        y < zone.y + zone.height
    );
    setHoveredZone(hovered || null);
  };

  const handleMouseUp = () => {
    if (!isAuthUser || !isDragging || !currentSelection) {
      setIsDragging(false);
      return;
    }

    const { x, y, width, height } = currentSelection;

    // Check for overlapping immediately
    if (isAreaOverlapping(x, y, width, height)) {
      setError("This area overlaps with an existing auction zone");
      setIsDragging(false);
      setCurrentSelection(null);
      drawCanvas();
      return;
    }

    const productsInArea = findProductsInArea(x, y, width, height);
    const isEmpty = isEmptyArea(x, y, width, height);

    if (!isEmpty && productsInArea.length === 0) {
      setError("This area contains products but could not identify them");
      setIsDragging(false);
      setCurrentSelection(null);
      return;
    }

    setIsDragging(false);
    setShowAuctionModal(true);
  };

  const confirmAuctionZone = () => {
    if (!currentSelection) {
      setError("No area selected to add");
      return null;
    }

    const { x, y, width, height } = currentSelection;

    // Double-check for overlaps before confirming
    if (isAreaOverlapping(x, y, width, height)) {
      setError("This area overlaps with an existing auction zone");
      return null;
    }

    const auctionEndDate = new Date(
      Date.now() + auctionDuration * 24 * 60 * 60 * 1000
    ).toISOString();
    const totalPixels = width * height;
    const basePrice = totalPixels * pixelPrice;

    const newZone: AuctionZone = {
      id: Date.now().toString(),
      x,
      y,
      width,
      height,
      products: currentSelection.products,
      isEmpty: currentSelection.isEmpty,
      status: "active",
      auctionEndDate,
      totalPixels,
      pixelPrice,
      buyNowPrice,
    };

    setAuctionZones([...auctionZones, newZone]);
    setError(null);
    drawCanvas();

    return newZone;
  };

  const saveAuctionZones = async () => {
    if (!currentSelection) return;

    const { x, y, width, height } = currentSelection;
    if (isAreaOverlapping(x, y, width, height)) {
      setError("This area overlaps with an existing Zone");
      return;
    }

    const newZone = confirmAuctionZone();
    if (!newZone) return;

    setIsSaving(true);
    try {
      const response = await fetch("/api/auction-zones", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          x: newZone.x,
          y: newZone.y,
          width: newZone.width,
          height: newZone.height,
          productIds: newZone.products.map((p: any) => p._id),
          isEmpty: newZone.isEmpty,
          status: newZone.status,
          auctionEndDate: newZone.auctionEndDate,
          buyNowPrice: newZone.buyNowPrice,
          totalPixels: newZone.totalPixels,
          pixelPrice: newZone.pixelPrice,
        }),
      });

      if (!response.ok) {
        if (response.status === 409) {
          throw new Error("Cannot add new zones while another zone is active");
        }
        throw new Error("Failed to save auction zone");
      }

      const data = await response.json();

      setAuctionZones((prev) =>
        prev.map((zone) =>
          zone.id === newZone.id ? { ...zone, id: data._id } : zone
        )
      );

      setError(null);
      alert("Auction zone saved successfully!");
      setShowAuctionModal(false);
      window.location.reload();
    } catch (err: any) {
      setError(err.message || "Failed to save auction zone");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!hoveredZone?.isEmpty && hoveredZone?.products?.url) {
      window.open(hoveredZone.products.url, "_blank");
      return;
    } else if (hoveredZone) {
      if (!user) {
        const confirmed = window.confirm(
          "You need to log in first to place a bid or purchase this zone."
        );
        if (confirmed) {
          router.push("/login");
        }
      } else {
        setShowAuctionModal(false);
        router.push(`/auctions/${hoveredZone.id}`);
      }
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const x = Math.floor(mouseX / pixelSize);
    const y = Math.floor(mouseY / pixelSize);

    const product = productMap.current[y * cols + x];

    if (product) {
      router.push(`/product/${product._id}`);
      return;
    }
  };

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  return (
    <div className="col-lg-12 p-0">
      <div className="card million-dollar-style">
        <div className="card-body">
          <div className="position-relative">
            {/* Overlap Alert */}
            {showOverlapAlert && (
              <div
                style={{
                  position: "fixed",
                  top: "20px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "#ff4444",
                  color: "white",
                  padding: "10px 20px",
                  borderRadius: "5px",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
                  zIndex: 2000,
                  animation: "fadeInOut 2s ease-in-out",
                }}
              >
                Warning: This area overlaps with an existing zone!
              </div>
            )}

            <div
              ref={containerRef}
              style={{
                overflowY: "auto",
                maxHeight: "70vh",
                paddingBottom: 0,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: 0,
                }}
              >
               
              </div>
              <div>
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onClick={handleClick}
                  style={{
                    cursor: isAuthUser
                      ? "pointer"
                      : hoveredProduct || hoveredZone
                      ? "pointer"
                      : "default",
                    backgroundColor: "#fff",
                  }}
                />
              </div>
            </div>

            {hoveredZone && (
              <div
                style={{
                  position: "fixed",
                  left: `${hoverPosition.x + 20}px`,
                  top: `${hoverPosition.y + 20}px`,
                  background: "white",
                  padding: "10px",
                  borderRadius: "5px",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
                  border: `2px solid ${
                    hoveredZone.status === "sold"
                      ? "#00c800"
                      : hoveredZone.status === "expired"
                      ? "#c80000"
                      : "#0064ff"
                  }`,
                  cursor: "pointer !important",
                  zIndex: 1000,
                }}
              >
                <h5>{hoveredZone.isEmpty ? "Empty Auction Zone" : ""}</h5>

                {hoveredZone.isEmpty && (
                  <>
                    <p>
                      Size: {hoveredZone.width}x{hoveredZone.height} pixels
                    </p>
                    <p>Total Pixels: {hoveredZone.totalPixels}</p>
                    <p>
                      Position: ({hoveredZone.x}, {hoveredZone.y}){" "}
                    </p>
                    <p>Status: {hoveredZone.status.toUpperCase()}</p>
                    {hoveredZone.auctionEndDate && (
                      <p>
                        Ends:{" "}
                        {new Date(
                          hoveredZone.auctionEndDate
                        ).toLocaleString()}{" "}
                      </p>
                    )}
                    {hoveredZone.buyNowPrice && (
                      <p>
                        Buy Now Price: ${" "}
                        {hoveredZone.buyNowPrice <= 1
                          ? ""
                          : hoveredZone.buyNowPrice.toFixed(2)}{" "}
                      </p>
                    )}
                    {hoveredZone.pixelPrice && (
                      <p>Pixel Price: ${hoveredZone.pixelPrice.toFixed(2)}</p>
                    )}
                  </>
                )}
                {!hoveredZone.isEmpty && (
                  <div>
                    <img
                      src={hoveredZone.products?.images[0]}
                      alt={hoveredZone.products?.title}
                      style={{
                        width: "100px",
                        height: "70px",
                        objectFit: "cover",
                        marginBottom: "10px",
                      }}
                    />
                    <a href={hoveredZone.products?.url}>
                      {hoveredZone.products?.url}
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showAuctionModal && currentSelection && (
        <div
          className="modal show"
          style={{
            display: "block",
            backgroundColor: "rgba(0,0,0,0.5)",
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1050,
            overflow: "auto",
          }}
        >
          <div
            className="modal-dialog modal-dialog-centered modal-lg"
            style={{
              maxWidth: "40vw",
              margin: "1.75rem auto",
            }}
          >
            <div
              className="modal-content"
              style={{
                maxHeight: "90vh",
                overflow: "hidden",
                boxShadow: "0 0.5rem 1rem rgba(0, 0, 0, 0.15)",
              }}
            >
              <div className="modal-header bg-primary text-white">
                <h5 className="modal-title">Create Auction Zone</h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => {
                    setShowAuctionModal(false);
                    setCurrentSelection(null);
                  }}
                  aria-label="Close"
                />
              </div>

              <div
                className="modal-body"
                style={{
                  overflowY: "auto",
                  padding: "20px",
                }}
              >
                {error && (
                  <div className="alert alert-danger mt-3">
                    <strong>Error:</strong> {error}
                  </div>
                )}

                <div className="row">
                  <div className="col-md-6 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Auction Duration (Days)
                      </label>
                      <select
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                        value={auctionDuration}
                        onChange={(e) => setAuctionDuration(Number(e.target.value))}
                      >
                        <option value="7">7 Days</option>
                      </select>
                    </div>
                    <div></div>
                  </div>

                  <div className="col-md-6 mb-3">
                    <label className="form-label fw-bold">
                      Bid Price Per Pixel ($)
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      min="0.01"
                      step="0.01"
                      value={pixelPrice <= 0 ? "" : pixelPrice}
                      onChange={(e) => setPixelPrice(parseFloat(e.target.value))}
                      placeholder="Enter price per pixel"
                    />
                    <small className="text-muted">
                      Price per pixel for bids
                    </small>
                  </div>

                  <div className="col-md-6 mb-3">
                    <label className="form-label fw-bold">
                      Instant Buy Price Per Pixel ($)
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      step="0.01"
                      min={minBuyNowPrice}
                      placeholder={`Min $${minBuyNowPrice.toFixed(2)} per pixel`}
                      value={buyNowPrice}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        setBuyNowPrice(
                          isNaN(newValue)
                            ? minBuyNowPrice
                            : Math.max(minBuyNowPrice, newValue)
                        );
                      }}
                    />
                    <small className="text-muted">
                      Minimum price per pixel: ${minBuyNowPrice.toFixed(2)}
                    </small>
                  </div>

                  <div className="col-md-6 mb-3 d-flex align-items-end">
                    <div className="w-100">
                      <p className="mb-1 fw-bold">Total Pixels:</p>
                      <div className="alert alert-secondary py-2 mb-0">
                        {currentSelection.width * currentSelection.height} pixels
                      </div>
                    </div>
                  </div>
                </div>

                <div className="alert alert-info mt-3">
                  <h6 className="fw-bold mb-3">Zone Details</h6>

                  <div className="row">
                    <div className="col-sm-4 mb-2">
                      <p className="mb-0 fw-medium">Size:</p>
                      <p className="mb-0">
                        {currentSelection.width}x{currentSelection.height}{" "}
                        pixels
                      </p>
                    </div>

                    <div className="col-sm-4 mb-2">
                      <p className="mb-0 fw-medium">Position:</p>
                      <p className="mb-0">
                        ({currentSelection.x}, {currentSelection.y})
                      </p>
                    </div>

                    <div className="col-sm-4 mb-2">
                      <p className="mb-0 fw-medium">Base Price:</p>
                      <p className="mb-0">
                        $
                        {(
                          currentSelection.width *
                          currentSelection.height *
                          pixelPrice
                        ).toFixed(2)}
                      </p>
                    </div>

                    <div className="col-sm-4 mb-2">
                      <p className="mb-0 fw-medium">Instant Buy Price:</p>
                      <p className="mb-0">
                        $
                        {(
                          currentSelection.width *
                          currentSelection.height *
                          buyNowPrice
                        ).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {!currentSelection.isEmpty && (
                    <div className="mt-3">
                      <p className="mb-1 fw-medium">
                        Contains {currentSelection.products.length} product(s):
                      </p>
                      <ul className="mb-2">
                        {currentSelection.products.map((product) => (
                          <li key={product._id}>
                            {product.title} - $
                            {product.price?.toFixed(2) || "0.00"}
                          </li>
                        ))}
                      </ul>
                      <p className="mb-0 fw-medium">
                        Total Products Value: $
                        {currentSelection.products
                          .reduce((sum, p) => sum + (p.price || 0), 0)
                          .toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowAuctionModal(false);
                    setCurrentSelection(null);
                    setError(null);
                    drawCanvas();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    saveAuctionZones();
                  }}
                  disabled={isSaving}
                >
                  {isSaving ? "Creating..." : "Create Auction Zone"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

