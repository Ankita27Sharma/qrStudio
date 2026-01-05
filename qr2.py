import qrcode
from PIL import Image
qr = qrcode.QRCode(
    version=1,error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=5,border=4,)
qr.add_data('https://www.linkedin.com/in/ankita-sharma27439/')
qr.make(fit=True)
qr_img = qr.make_image(fill_color="purple", back_color="pink")
qr_img.save("custom_linkedin_qr.png")