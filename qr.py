#pip install qrcode[pil]

import qrcode as qr
img= qr.make("https://www.linkedin.com/in/ankita-sharma27439/")
img.save("linkedin_qr.png")